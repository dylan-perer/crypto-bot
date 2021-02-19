const Binance = require("node-binance-api");
const {
  logError,
  logWarn,
  log,
  logInfo,
  debug,
  setDebugMode,
} = require("../logger");

const { startListening } = require("../email");
const { LONG, SHORT } = require("./constants");

module.exports = class Bot {
  constructor(
    {
      symbol,
      margin,
      shortStoploss,
      shortTakeprofit,
      longStoploss,
      longTakeprofit,
    },
    isDebug
  ) {
    this.config = {
      symbol: symbol,
      margin: margin,

      shortStoplossPercentage: shortStoploss,
      shortTakeprofitPercentage: shortTakeprofit,
      longStoplossPercentage: longStoploss,
      longTakeprofitPercentage: longTakeprofit,
    };

    this.state = {
      side: null,

      shortStoploss: null,
      shortTakeprofit: null,
      longStoploss: null,
      longTakeprofit: null,

      orderId: null,
      executedQty: null,
      currentPrice: null,
      currentProfit: null,
      takeProfitOrderId: null,

      isStreamReady: false,
      isBotOn: false,
      isBotStarting: false,
      listenToShortExit: false,
      listenToLongExit: false,

      activeListener: null,
    };

    //options
    this.debug = isDebug;

    this.Binance = new Binance().options({
      APIKEY: process.env.API_KEY,
      APISECRET: process.env.SECRET_KEY,
      useServerTime: true,
      recvWindow: 6000000, // Set a higher recvWindow to increase response timeout
      verbose: true, // Add extra output when subscribing to WebSockets, etc
      log: (log) => {
        console.log(log); // You can create your own logger here, or disable console output
      },
    });

    debug(`Bot configured :: ${JSON.stringify(this.config)}`, isDebug);
    debug(`Bot current state :: {${JSON.stringify(this.state)}}`, isDebug);

    //start price stream
    this.Binance.futuresMiniTickerStream(this.config.symbol, this.tick);
  }

  asyncTimeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Binance {
  //   return new Binance().options({
  //     APIKEY: process.env.API_KEY,
  //     APISECRET: process.env.SECRET_KEY,
  //   });
  // }

  //on failed api call
  async onFailedApiCall(
    apiCallFunction,
    apiFunctionParamas = null,
    caller,
    ...expectedOutputParams
  ) {
    let isApiCallSuccess = false;
    let data = null;
    let returnedData = null;

    do {
      try {
        //handle calling binnace api and passing args
        if (apiFunctionParamas === null) data = await apiCallFunction();
        else data = await apiCallFunction(...apiFunctionParamas);

        if (data["code"] === -1022) {
          logError("YESS");
          this.Binance = new Binance().options({
            APIKEY: process.env.API_KEY,
            APISECRET: process.env.SECRET_KEY,
            useServerTime: true,
            recvWindow: 6000000, // Set a higher recvWindow to increase response timeout
            verbose: true, // Add extra output when subscribing to WebSockets, etc
            log: (log) => {
              console.log(log); // You can create your own logger here, or disable console output
            },
          });
        }
        //capture original data
        returnedData = data;

        //check for expected output data
        expectedOutputParams.map((item, idx) => {
          data = data[item];
        });
        if (data) {
          // logWarn(data);
          isApiCallSuccess = true;
        } else {
          logWarn(
            `${caller} returned unexpected data... data: ${JSON.stringify(
              returnedData
            )}`
          );
          throw "err";
        }
      } catch (error) {
        logWarn(`failed calling ${caller}`);
        logWarn("Retrying in 3 seconds...");
        await this.asyncTimeout(3000);
      }
    } while (!isApiCallSuccess);

    return { data: data, returnedData: returnedData };
  }

  async getBalanceInUSDT() {
    try {
      const funcRef = this.Binance.futuresAccount;
      const { data: account, returnedData } = await this.onFailedApiCall(
        funcRef,
        null,
        "getBalanceInUSDT()",
        "assets",
        0,
        "walletBalance"
      );
      return account;
    } catch (error) {
      logError(`Error getBalanceInUSDT ${error}`);
    }
  }

  //Calculate the maximum tradeable amount
  async getMaxTradeAmount() {
    try {
      const balance = await this.getBalanceInUSDT();

      //Calculating max trade amount
      const maxTradeAmount =
        Math.floor(
          ((balance * this.config.margin) / this.state.currentPrice) * 1000
        ) / 1000;

      // error margin of 0.01% just to be safe.
      return Math.floor((maxTradeAmount - maxTradeAmount * 0.05) * 1000) / 1000;
    } catch (error) {
      logError(`Failed to get max trade amount ::: ${error}`);
    }
  }

  //Price stream tick, updates when price changes
  tick = (symbolData) => {
    if (symbolData.close) {
      this.state.currentPrice = symbolData.close;
      this.state.isStreamReady = true;
    } else {
      logError("Error, close price stream is undefined!");
    }
  };

  placeMarketOrderBuy = async (msg = "Long") => {
    try {
      const maxTradeAmount = await this.getMaxTradeAmount();
      const order = await this.Binance.futuresMarketBuy(
        this.config.symbol,
        maxTradeAmount,
        {
          newOrderRespType: "RESULT",
        }
      );
      let { orderId, symbol, status, avgPrice, origQty } = order;
      logInfo(
        `${msg} market order placed. id: ${orderId} symbol: ${symbol} status: ${status} avgPrice: ${avgPrice} origQty: ${origQty}`
      );
      return order;
    } catch (error) {
      logError(`Failed to place market buy order ::: ${error}`);
    }
  };

  placeMarketOrderSell = async (msg = "Short") => {
    try {
      const maxTradeAmount = await this.getMaxTradeAmount();

      const order = await this.Binance.futuresMarketSell(
        this.config.symbol,
        maxTradeAmount,
        {
          newOrderRespType: "RESULT",
        }
      );
      let { orderId, symbol, status, avgPrice, origQty } = order;
      logInfo(
        `${msg} market order placed. id: ${orderId} symbol: ${symbol} status: ${status} avgPrice: ${avgPrice} origQty: ${origQty}`
      );
      return order;
    } catch (error) {
      logError(`Failed to place market sell order ::: ${error}`);
    }
  };

  onAlert = async (price, side) => {
    try {
      if (side === LONG) {
        if (this.state.side === SHORT) {
          //stop listening to exit
          this.stopShortExitListener();
          //cancel takeprofit order
          this.cancelLimitOrder(this.state.takeProfitOrderId);
          //exit short position
          const exitShort = await this.placeMarketOrderBuy("Exit short");
          logInfo(`Current short position was exited.`);
          debug(`${JSON.stringify(exitShort)}`, this.debug);

          //go into new long position
          this.long();
        } else {
          this.long();
        }
      } else if (side === SHORT) {
        if (this.state.side === LONG) {
          //stop listening to exit
          this.stopLongExitListener();
          //cancel takeprofit order
          this.cancelLimitOrder(this.state.takeProfitOrderId);
          //exit short position
          const exitLong = await this.placeMarketOrderSell("Exit long");
          logInfo(`Current long position was exited.`);
          debug(`${JSON.stringify(exitLong)}`, this.debug);
          //go into new long position
          this.short();
        } else {
          this.short();
        }
      }
    } catch (error) {
      logError(`Failed on alert ::: ${error}`);
    }
  };

  getOrderStatus = async (orderId) => {
    try {
      const funcRef = await this.Binance.futuresOrderStatus;
      return await this.onFailedApiCall(
        funcRef,
        [this.config.symbol, { orderId: "" + orderId }],
        "getOrderStatus()",
        "executedQty"
      );
    } catch (error) {
      logError(`Failed to get order status ::: ${error}`);
    }
  };

  cancelLimitOrder = async (orderId) => {
    try {
      return await this.Binance.futuresCancel(this.config.symbol, {
        orderId: "" + orderId,
      });
    } catch (error) {
      logError(`Failed to cancel limit order ::: ${error}`);
      return null;
    }
  };

  longExitListener2 = async () => {
    logWarn("(LONG)...");
    try {
      const {
        data: executedQty,
        returnedData: orderStatusDetails,
      } = await this.getOrderStatus(this.state.takeProfitOrderId);
      if (this.state.listenToLongExit) {
        //Check if takeprofit order is filled
        if (executedQty === this.state.executedQty) {
          //take profit order is complete
          logInfo(`Take profit order comepleted!`);
          this.state.listenToLongExit = false;
          this.state.side = null;
        }
        //check if stoploss is met
        else if (this.state.currentPrice <= this.state.longStoploss) {
          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderSell(
            "(LONG) stoploss"
          );

          this.state.listenToLongExit = false;
          this.state.side = null;
        } else {
          await this.asyncTimeout(3000);
          this.longExitListener();
        }
      }
    } catch (error) {
      logError(`Failed to listen for long exit ::: ${error}`);
    }
  };

  shortExitListener2 = async () => {
    try {
      const executedQty = await this.getOrderStatus(
        this.state.takeProfitOrderId
      );
      logWarn(`${new Date().toString()} short... execQTY:${executedQty}`);
      if (this.state.listenToShortExit) {
        //Check if takeprofit order is filled
        if (executedQty === this.state.executedQty) {
          //take profit order is complete
          logInfo(`Take profit order comepleted!`);
          this.state.listenToShortExit = false;
          this.state.side = null;
        }
        //check if stoploss is met
        else if (this.state.currentPrice >= this.state.shortStoploss) {
          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderBuy(
            "(SHORT) stoploss"
          );

          this.state.listenToShortExit = false;
          this.state.side = null;
        } else {
          await this.asyncTimeout(3000);
          this.shortExitListener();
        }
      }
    } catch (error) {
      logError(`Failed to listen for short exit ::: ${error}`);
    }
  };

  short = async () => {
    try {
      //place short market order
      const order = await this.placeMarketOrderSell();

      //calulate and set take profit & stop loss values
      const orderAvgPrice = parseFloat(order.avgPrice);
      this.state.executedQty = order.origQty;
      //percentages calculation
      this.state.shortStoploss = this.calculatePercentage(
        orderAvgPrice,
        this.config.shortStoplossPercentage
      );
      this.state.shortTakeprofit = this.calculatePercentage(
        orderAvgPrice,
        -1 * this.config.shortTakeprofitPercentage
      );

      //place take profit limit order
      const takeProfitOrder = await this.Binance.futuresBuy(
        this.config.symbol,
        order.executedQty,
        this.state.shortTakeprofit
      );

      this.state.takeProfitOrderId = takeProfitOrder.orderId;
      this.state.side = SHORT;
      logInfo(
        `Take profit limit order placed. id: ${takeProfitOrder.orderId} symbol: ${takeProfitOrder.symbol} status: ${takeProfitOrder.status} price: ${takeProfitOrder.price} origQty: ${takeProfitOrder.origQty} executedQty: ${takeProfitOrder.executedQty}`
      );

      //start listening to exit strats
      this.state.listenToShortExit = true;
      debug(
        `State after a short position is set ${JSON.stringify(this.state)}`,
        this.debug
      );
      logWarn("(SHORT) Listening for a exit..");
      this.state.activeListener = await this.startShortExitListener();
    } catch (error) {
      logError(`Erorr going short ::: ${error}`);
      //send err notifcation
    }
  };

  long = async () => {
    try {
      //place short market order
      const order = await this.placeMarketOrderBuy();

      //calulate and set take profit & stop loss values
      const orderAvgPrice = parseFloat(order.avgPrice);
      this.state.executedQty = order.origQty;

      this.state.longStoploss = this.calculatePercentage(
        orderAvgPrice,
        -1 * this.config.longStoplossPercentage
      );
      this.state.longTakeprofit = this.calculatePercentage(
        orderAvgPrice,
        1 * this.config.longTakeprofitPercentage
      );

      //place take profit limit order
      const takeProfitOrder = await this.Binance.futuresSell(
        this.config.symbol,
        order.executedQty,
        this.state.longTakeprofit
      );

      this.state.takeProfitOrderId = takeProfitOrder.orderId;
      this.state.side = LONG;

      logInfo(
        `Take profit limit order placed. id: ${takeProfitOrder.orderId} symbol: ${takeProfitOrder.symbol} status: ${takeProfitOrder.status} price: ${takeProfitOrder.price} origQty: ${takeProfitOrder.origQty} executedQty: ${takeProfitOrder.executedQty}`
      );

      //start listening to exit strats
      this.state.listenToLongExit = true;
      debug(
        `State after a long position is set ${JSON.stringify(this.state)}`,
        this.debug
      );
      logWarn("(LONG) Listening for a exit..");
      this.state.activeListener = await this.startLongExitListener();
    } catch (error) {
      logError(`Erorr going long ::: ${error}`);
      //send err notifcation
    }
  };

  startShortExitListener = async () => {
    const listener = async () => {
      if (this.state.listenToShortExit) {
        const {
          data: executedQty,
          returnedData: orderStatusDetails,
        } = await this.getOrderStatus(this.state.takeProfitOrderId);

        if (orderStatusDetails.status !== "CANCELED") {
          //check if limit order if filled
          if (executedQty === this.state.executedQty) {
            this.stopShortExitListener();
            logInfo(
              `Take profit limit order filled! ${JSON.stringify(
                orderStatusDetails
              )}`
            );
          }
          logInfo(
            `${new Date().toString()} listening to short exit... execQTY:${executedQty}`
          );
          // logWarn(`${JSON.stringify(orderStatusDetails)}`);
        } else {
          logWarn(`takeprofit order was cancelled!`);
        }
        //check if stoloss is hit
        if (this.state.currentPrice >= this.state.shortStoploss) {
          //first stop the listener being call again.
          this.stopShortExitListener();
          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderBuy(
            "(SHORT) stoploss"
          );
          logInfo(
            `Stoploss hit!, short exited short with market buy order ${JSON.stringify(
              stopLossOrder
            )}`
          );
        }
      }
    };
    return setInterval(listener, 2000);
  };

  startLongExitListener = async () => {
    const listener = async () => {
      if (this.state.listenToLongExit) {
        const {
          data: executedQty,
          returnedData: orderStatusDetails,
        } = await this.getOrderStatus(this.state.takeProfitOrderId);

        if (orderStatusDetails.status !== "CANCELED") {
          //check if limit order if filled
          if (executedQty === this.state.executedQty) {
            this.stopLongExitListener();
            logInfo(
              `Take profit limit order filled! ${JSON.stringify(
                orderStatusDetails
              )}`
            );
          }
          logInfo(
            `${new Date().toString()} listening to long exit... execQTY:${executedQty}`
          );
          // logWarn(`${JSON.stringify(orderStatusDetails)}`);
        } else {
          logWarn(`takeprofit order was cancelled!`);
        }
        //check if stoloss is hit
        if (this.state.currentPrice <= this.state.longStoploss) {
          //first stop the listener being call again.
          this.stopLongExitListener();

          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderSell(
            "(LONG) stoploss"
          );
          logInfo(
            `Stoploss hit!, long exited long with market buy order ${JSON.stringify(
              stopLossOrder
            )}`
          );
        }
      }
    };
    return setInterval(listener, 2500);
  };

  stopShortExitListener = () => {
    this.state.listenToShortExit = false;
    this.state.side = null;
    clearInterval(this.state.activeListener);
    log("stopped short exit listner...");
  };

  stopLongExitListener = () => {
    this.state.listenToLongExit = false;
    this.state.side = null;
    clearInterval(this.state.activeListener);
    log("stopped long exit listner...");
  };

  calculatePercentage = (value, percentage) => {
    percentage = percentage / 100 + 1;
    return parseFloat(value * percentage).toFixed(2);
  };

  startBot = async () => {
    try {
      if (this.state.currentPrice !== null && this.state.isStreamReady) {
        startListening(this.onAlert);
        log(`Bot has started...`);
        logInfo(`Balance is ${await this.getBalanceInUSDT()} USDT`);
        const margin = await this.Binance.futuresLeverage(
          this.config.symbol,
          this.config.margin
        );
        logInfo(`Margin adjusted to x${margin.leverage}`);
        logInfo(
          `Your max trading amount is  ${await this.getMaxTradeAmount(
            this.state.currentPrice
          )}`
        );
      }
    } catch (error) {
      logError(`Failed to start the bot ::: ${error}`);
    }
  };
};
