/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Market, Comptroller } from '../types/schema'
// PriceOracle is valid from Comptroller deployment until block 8498421
import { PriceOracle } from '../types/templates/CToken/PriceOracle'
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
import { PriceOracle2 } from '../types/templates/CToken/PriceOracle2'
import { ERC20 } from '../types/templates/CToken/ERC20'
import { CToken } from '../types/templates/CToken/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
  zeroBD,
} from './helpers'

let cUSDTAddress = '0x27eff5269c3a5187c67ab990010d0d87aad3765e'
let cETHAddress = '0x7836A1cfd01a994829e17DF0bF11dD7F9d820c82'
//let daiAddress = '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359'

// Used for all cERC20 contracts
function getTokenPrice(
  blockNumber: i32,
  eventAddress: Address,
  underlyingAddress: Address,
  underlyingDecimals: i32,
): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let underlyingPrice: BigDecimal
  let priceOracle1Address = Address.fromString(
    '0xdDcb492Fe8F8e2726f8Ed90f9abb3588219Eac31',
  )

  /* PriceOracle2 is used at the block the Comptroller starts using it.
   * see here https://etherscan.io/address/0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b#events
   * Search for event topic 0xd52b2b9b7e9ee655fcb95d2e5b9e0c9f69e7ef2b8e9d2d0ea78402d576d22e22,
   * and see block 7715908.
   *
   * This must use the cToken address.
   *
   * Note this returns the value without factoring in token decimals and wei, so we must divide
   * the number by (ethDecimals - tokenDecimals) and again by the mantissa.
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30
   *
   * Note that they deployed 3 different PriceOracles at the beginning of the Comptroller,
   * and that they handle the decimals different, which can break the subgraph. So we actually
   * defer to Oracle 1 before block 7715908, which works,
   * until this one is deployed, which was used for 121 days */
  if (blockNumber > 7715908) {
    let mantissaDecimalFactor = 18 - underlyingDecimals + 18
    let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
    let oracle2 = PriceOracle2.bind(oracleAddress)
    let tryPrice = oracle2.try_getUnderlyingPrice(eventAddress)

    underlyingPrice = tryPrice.reverted
      ? zeroBD
      : tryPrice.value.toBigDecimal().div(bdFactor)

    /* PriceOracle(1) is used (only for the first ~100 blocks of Comptroller. Annoying but we must
     * handle this. We use it for more than 100 blocks, see reason at top of if statement
     * of PriceOracle2.
     *
     * This must use the token address, not the cToken address.
     *
     * Note this returns the value already factoring in token decimals and wei, therefore
     * we only need to divide by the mantissa, 10^18 */
  } else {
    let oracle1 = PriceOracle.bind(priceOracle1Address)
    underlyingPrice = oracle1
      .getPrice(underlyingAddress)
      .toBigDecimal()
      .div(mantissaFactorBD)
  }
  return underlyingPrice
}

// Returns the price of USDC in eth. i.e. 0.005 would mean ETH is $200
function getUSDTpriceETH(blockNumber: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let priceOracle1Address = Address.fromString(
    '0xdDcb492Fe8F8e2726f8Ed90f9abb3588219Eac31',
  )
  let USDTAddress = '0x55d398326f99059ff775485246999027b3197955 '
  let usdPrice: BigDecimal

  // See notes on block number if statement in getTokenPrices()
  if (blockNumber > 7715908) {
    let oracle2 = PriceOracle2.bind(oracleAddress)
    let mantissaDecimalFactorUSDT = 18 - 6 + 18
    let bdFactorUSDT = exponentToBigDecimal(mantissaDecimalFactorUSDT)
    let tryPrice = oracle2.try_getUnderlyingPrice(Address.fromString(cUSDTAddress))

    usdPrice = tryPrice.reverted
      ? zeroBD
      : tryPrice.value.toBigDecimal().div(bdFactorUSDT)
  } else {
    let oracle1 = PriceOracle.bind(priceOracle1Address)
    usdPrice = oracle1
      .getPrice(Address.fromString(USDTAddress))
      .toBigDecimal()
      .div(mantissaFactorBD)
  }
  return usdPrice
}

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))

  // It is CETH, which has a slightly different interface
  if (marketAddress == cETHAddress) {
    market = new Market(marketAddress)
    market.underlyingAddress = Address.fromString(
      '0x0000000000000000000000000000000000000000',
    )
    market.underlyingDecimals = 18
    market.underlyingPrice = BigDecimal.fromString('1')
    market.underlyingName = 'Ether'
    market.underlyingSymbol = 'ETH'
    market.underlyingPriceUSD = zeroBD
    // It is all other CERC20 contracts
  } else {
    market = new Market(marketAddress)
    market.underlyingAddress = contract.underlying()
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
    // if (market.underlyingAddress.toHexString() != daiAddress) {
    //   market.underlyingName = underlyingContract.name()
    //   market.underlyingSymbol = underlyingContract.symbol()
    // } else {
    //   market.underlyingName = 'Dai Stablecoin v1.0 (DAI)'
    //   market.underlyingSymbol = 'DAI'
    // }
    market.underlyingPriceUSD = zeroBD
    market.underlyingPrice = zeroBD
    if (marketAddress == cUSDTAddress) {
      market.underlyingPriceUSD = BigDecimal.fromString('1')
    }
  }

  let interestRateModelAddress = contract.try_interestRateModel()
  let reserveFactor = contract.try_reserveFactorMantissa()

  market.borrowRate = zeroBD
  market.cash = zeroBD
  market.collateralFactor = zeroBD
  market.exchangeRate = zeroBD
  market.interestRateModelAddress = interestRateModelAddress.reverted
    ? Address.fromString('0x0000000000000000000000000000000000000000')
    : interestRateModelAddress.value
  market.name = contract.name()
  market.reserves = zeroBD
  market.supplyRate = zeroBD
  market.symbol = contract.symbol()
  market.totalBorrows = zeroBD
  market.totalSupply = zeroBD

  market.accrualBlockNumber = 0
  market.blockTimestamp = 0
  market.borrowIndex = zeroBD
  market.reserveFactor = reserveFactor.reverted ? BigInt.fromI32(0) : reserveFactor.value

  return market
}

// Only to be used after block 10678764, since it's aimed to fix the change to USD based price oracle.
function getETHinUSD(blockNumber: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let oracle = PriceOracle2.bind(oracleAddress)
  let tryPrice = oracle.try_getUnderlyingPrice(Address.fromString(cETHAddress))

  let ethPriceInUSD = tryPrice.reverted
    ? zeroBD
    : tryPrice.value.toBigDecimal().div(mantissaFactorBD)

  return ethPriceInUSD
}

export function updateMarket(
  marketAddress: Address,
  blockNumber: i32,
  blockTimestamp: i32,
): Market {
  let marketID = marketAddress.toHexString()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }

  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    let contractAddress = Address.fromString(market.id)
    let contract = CToken.bind(contractAddress)

    // After block 10678764 price is calculated based on USD instead of ETH
    if (blockNumber > 10678764) {
      let ethPriceInUSD = getETHinUSD(blockNumber)

      // if cETH, we only update USD price
      if (market.id == cETHAddress) {
        market.underlyingPriceUSD = ethPriceInUSD.truncate(market.underlyingDecimals)
      } else {
        let tokenPriceUSD = getTokenPrice(
          blockNumber,
          contractAddress,
          market.underlyingAddress as Address,
          market.underlyingDecimals,
        )
        market.underlyingPrice = tokenPriceUSD
          .div(ethPriceInUSD)
          .truncate(market.underlyingDecimals)
        // if USDC, we only update ETH price
        if (market.id != cUSDTAddress) {
          market.underlyingPriceUSD = tokenPriceUSD.truncate(market.underlyingDecimals)
        }
      }
    } else {
      let usdPriceInEth = getUSDTpriceETH(blockNumber)

      // if cETH, we only update USD price
      if (market.id == cETHAddress) {
        market.underlyingPriceUSD = market.underlyingPrice
          .div(usdPriceInEth)
          .truncate(market.underlyingDecimals)
      } else {
        let tokenPriceEth = getTokenPrice(
          blockNumber,
          contractAddress,
          market.underlyingAddress as Address,
          market.underlyingDecimals,
        )
        market.underlyingPrice = tokenPriceEth.truncate(market.underlyingDecimals)
        // if USDT, we only update ETH price
        if (market.id != cUSDTAddress) {
          market.underlyingPriceUSD = market.underlyingPrice
            .div(usdPriceInEth)
            .truncate(market.underlyingDecimals)
        }
      }
    }

    market.accrualBlockNumber = contract.accrualBlockNumber().toI32()
    market.blockTimestamp = blockTimestamp
    market.totalSupply = contract
      .totalSupply()
      .toBigDecimal()
      .div(cTokenDecimalsBD)

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
        - If you call the cUSDT contract on etherscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDT 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */
    market.exchangeRate = contract
      .exchangeRateStored()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .times(cTokenDecimalsBD)
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)
    market.borrowIndex = contract
      .borrowIndex()
      .toBigDecimal()
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    market.reserves = contract
      .totalReserves()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.totalBorrows = contract
      .totalBorrows()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.cash = contract
      .getCash()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)

    // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
    market.borrowRate = contract
      .borrowRatePerBlock()
      .toBigDecimal()
      .times(BigDecimal.fromString('2102400'))
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
    // So we handle it like this.
    let supplyRatePerBlock = contract.try_supplyRatePerBlock()
    if (supplyRatePerBlock.reverted) {
      log.info('***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted', [])
      market.supplyRate = zeroBD
    } else {
      market.supplyRate = supplyRatePerBlock.value
        .toBigDecimal()
        .times(BigDecimal.fromString('2102400'))
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    }
    market.save()
  }
  return market as Market
}
