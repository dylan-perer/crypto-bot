const Binance = require("node-binance-api-ext");
const { startListening, parseAlert } = require("../email");
const { LONG, SHORT, STOPLOSS } = require("./constants");

module.exports = class Bot {
  constructor({ symbol, leverage }) {
    this.binance = Binance({
      APIKEY: process.env.API_KEY,
      APISECRET: process.env.SECRET_KEY,
    });

    this.config = {
      symbol: symbol,
      leverage: leverage,
    };
    this.state = {
      fundingRate: 0,
      streamHasStarted: false,
      streamOk: false,

      side: null,
      entryPrice: 0,
      currentPrice: 0,

      limitOrderId: null,
      qty: 0,
      limitOrderListener: null,
    };
  }

  //starts bot
  start = async () => {
    // console.log("Balance:", await this.getBalanceInUSDT(), "USDT");
    // console.log("Leverage", "x" + (await this.setLeverage()));

    // const limitOrder = await this.placeLimitOrder(LONG);
    // this.state.limitOrderId = limitOrder.orderId;
    // console.log("Limit Buy Order", limitOrder);
    this.startTickerStream();
  };

  trade = async () => {
    console.log("Balance:", await this.getBalanceInUSDT(), "USDT");
    console.log("Leverage:", "x" + (await this.setLeverage()));
    console.log("Max trade qty:", await this.getMaxTradeAmount());

    startListening(async (alertType) => {
      switch (alertType) {
        case STOPLOSS:
          //exit curent short position
          if (this.state.side === SHORT) {
            console.log(
              "Exited current short",
              await this.placeMarketOrder(LONG, this.state.qty)
            );
            this.state.side = null;
          }
          //exit curent long position
          else if (this.state.side === LONG) {
            console.log(
              "Exited current long",
              await this.placeMarketOrder(SHORT, this.state.qty)
            );
            this.state.side = null;
          }
          break;
        case LONG:
          if (this.state.side === SHORT) {
            //exit curent short position
            console.log(
              "Exited current short",
              await this.placeMarketOrder(LONG, this.state.qty)
            );
          }
          //enter new short position
          console.log("Placed new long position", await this.placeTrade(LONG));
          break;
        case SHORT:
          if (this.state.side === LONG) {
            //exit curent long position
            console.log(
              "Exited current long",
              await this.placeMarketOrder(SHORT, this.state.qty)
            );
          }
          //enter new long position
          console.log(
            "Placed new short position",
            await this.placeTrade(SHORT)
          );
          break;
        default:
          console.log("unknown alert!");
          break;
      }
    });
  };

  placeTrade = async (side) => {
    if (!side) return { error: "side is not specified" };

    try {
      const qty = await this.getMaxTradeAmount();
      const order = await this.placeMarketOrder(side, qty);
      this.state.qty = order.origQty;
      this.state.side = side;
      this.state.entryPrice = order.avgPrice;
      return order;
    } catch (error) {
      return { error: error };
    }
  };

  placeReducingLimitOrder = async (tries) => {
    //place a limit order with current price
    //timeout
    //check if filled
    //no
    //if tries > 0
    //tries - 1 & call place this func again
    //else
    //place a market order
    //yes
    //done
  };

  //get current funding rate
  getFundingRate = async () => {
    try {
      this.state.fundingRate = await this.binance.futures.exchangeInfo();
      return JSON.stringify(this.state.fundingRate);
    } catch (error) {
      return { error: error };
    }
  };

  //get current balance balance in USDT
  getBalanceInUSDT = async () => {
    try {
      const res = await this.binance.futures.balance();
      return parseFloat(res.USDT.available).toFixed(2);
    } catch (error) {
      return { error: error };
    }
  };

  //Calculate the maximum tradeable amount
  getMaxTradeAmount = async () => {
    try {
      const balance = await this.getBalanceInUSDT();

      //Calculating max trade amount
      const maxTradeAmount =
        Math.floor(
          ((balance * this.config.leverage) / this.state.currentPrice) * 1000
        ) / 1000;

      // error margin of 0.01% just to be safe.
      return Math.floor((maxTradeAmount - maxTradeAmount * 0.05) * 1000) / 1000;
    } catch (error) {
      logError(`Failed to get max trade amount ::: ${error}`);
    }
  };

  startTickerStream = () => {
    this.binance.webSocket.futuresMiniTickerStream(
      this.config.symbol,
      async ({ close }) => {
        this.state.currentPrice = close;
        // console.log(this.state.currentPrice);
        if (!this.state.streamHasStarted) {
          this.state.streamHasStarted = true;
          await this.trade();
        }
      }
    );
  };

  //adjust leverage
  setLeverage = async () => {
    try {
      const res = await this.binance.futures.leverage(
        this.config.symbol,
        this.config.leverage
      );
      return res.leverage;
    } catch (error) {
      return { error: error };
    }
  };

  //place a limit order
  placeLimitOrder = async (side, price, qty = this.state.qty) => {
    if (!side) return { error: "no side specified" };
    if (!price) return { error: "no price specified" };

    try {
      if (side === LONG) {
        return await this.binance.futures.buy(this.config.symbol, qty, price);
      } else if (side === SHORT) {
        return await this.binance.futures.sell(this.config.symbol, qty, price);
      }
    } catch (error) {
      return { error: error };
    }
  };

  //place market order
  placeMarketOrder = async (side, qty = this.state.qty) => {
    if (!side) return { error: "no side specified" };

    try {
      if (side === LONG) {
        return await this.binance.futures.marketBuy(this.config.symbol, qty);
      } else if (side === SHORT) {
        return await this.binance.futures.marketSell(this.config.symbol, qty);
      }
    } catch (error) {
      return { error: error };
    }
  };

  //get limit order status
  getLimitOrderStatus = async (orderId) => {
    if (!orderId) return { error: "no order id provided" };

    try {
      const res = await this.binance.futures.openOrders(this.config.symbol);
      let order = null;
      Array.from(res).map((item, idx) => {
        if (item.orderId == orderId) order = item;
      });
      if (order) return order;
      else throw "order was not found";
    } catch (error) {
      return { error: error };
    }
  };

  isOrderFilled = async (orderId) => {
    try {
      const limitOrder = await this.getLimitOrderStatus(orderId);
      if (limitOrder.executedQty) {
        return parseFloat(limitOrder.executedQty) ===
          parseFloat(limitOrder.origQty)
          ? true
          : false;
      } else {
        this.stopLimitOrderListener();
        throw "order was not found to check if filled.";
      }
    } catch (error) {
      return { error: error };
    }
  };

  cancelAllLimitOrders = async () => {
    try {
      const res = await this.binance.futures.cancelAll(this.config.symbol);
      if (res.code === 200) return true;
      else throw "canceling order failed";
    } catch (error) {
      return { error: error };
    }
  };

  //handle starting limit order listener
  startlimitOrderListener = async () => {
    //stop any existing listener
    this.stopLimitOrderListener();

    const listener = async () => {
      if (!this.state.limitOrderId)
        return { error: "listener error, order id was not provided" };
      try {
        const res = await this.isOrderFilled(this.state.limitOrderId);
        console.log("listening...", "res:", res);
        if (res === true) this.stopLimitOrderListener();
      } catch (error) {
        return { error: error };
      }
    };
    this.state.limitOrderListener = setInterval(listener, 2500);
    console.log("limit order listener has started...");
  };

  //handle stoping limit order listner
  stopLimitOrderListener = async () => {
    try {
      if (this.state.limitOrderListener !== null) {
        clearInterval(this.state.limitOrderListener);
        this.state.limitOrderListener = null;
        console.log("limit order listener has stoped...");
      }
    } catch (error) {
      return { error: error };
    }
  };
};
