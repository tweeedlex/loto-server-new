require("dotenv").config();
const express = require("express");
const app = express();
const WSServer = require("express-ws")(app);
const aWss = WSServer.getWss();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const router = require("./router/index");
const errorMiddleware = require("./middlewares/error-middleware");
const axios = require("axios");
const { Sequelize } = require("sequelize");
const {
  Loto,
  LotoGame,
  LotoCard,
  LotoSetting,
  Stats,
  BotStats,
  Bot,
  CurrencyRate,
} = require("./models/db-models");
const AdminLotoService = require("./service/loto-admin-service");
const gameService = require("./service/game-service");
const lotoAdminService = require("./service/loto-admin-service");
const roomsFunctions = require("./service/loto-rooms-functions");

const PORT = process.env.PORT || 5001;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use("/api", router);
app.use(errorMiddleware);

const getCurrency = async () => {
  const currency = await axios.get(
    "https://api.apilayer.com/currency_data/live?base=USD&symbols=EUR,GBP",
    {
      headers: {
        apikey: "ck1iyDdQa5oY4FesB3GSSNHnyTfuV6yy",
      },
    }
  );

  await CurrencyRate.update(
    {
      rate: currency.data.quotes.USDAZN,
    },
    { where: { id: 1 } }
  );
};

const start = async () => {
  try {
    const sequelize = require("./db");
    await sequelize.authenticate();
    await sequelize.sync();

    const currencyCheck = await CurrencyRate.findOne({ where: { id: 1 } });

    if (!currencyCheck) {
      await CurrencyRate.create({ id: 1, rate: 1.705 });
    }

    await getCurrency();
    setTimeout(async () => {
      await getCurrency();
    }, 1000 * 60 * 60 * 24);

    // for (let i = 0; i < 90; i++) {
    //   const randomUserdata = await axios.get(
    //     "https://random-data-api.com/api/v2/users"
    //   );
    //   const username = randomUserdata.data.first_name;
    //   await Bot.create({ username, lotoTokens: 1 });
    // }

    // await LotoGame.update(
    //   {
    //     bots: 0,
    //     isStarted: false,
    //     isWaiting: false,
    //     startedAt: null,
    //     finishesAt: null,
    //     prevBank: 0,
    //     botsTickets: JSON.stringify([]),
    //   },
    //   { where: { gameLevel: [1, 2, 3, 4, 5] } }
    // );
    // await LotoCard.destroy({ where: {} });

    // await BotStats.create();
    // await LotoGame.create({ gameLevel: 1 });
    // await LotoGame.create({ gameLevel: 2 });
    // await LotoGame.create({ gameLevel: 3 });
    // await LotoGame.create({ gameLevel: 4 });
    // await LotoGame.create({ gameLevel: 5 });
    // for (let i = 1; i <= 5; i++) {
    //   await LotoSetting.create({
    //     gameLevel: i,
    //     allowBots: true,
    //     maxBots: 4,
    //     maxTickets: 6,
    //     winChance: 20,
    //     jackpotWinChance: 20,
    //     minJackpotSum: 200,
    //   });
    // }

    // for (let i = 1; i <= 10; i++) {
    //   if (i !== 3) {
    //     await Stats.create({
    //       userId: i,
    //     });
    //   }
    // }

    app.listen(PORT, () => console.log(`Server started on PORT = ${PORT}`));
  } catch (e) {
    console.log(e);
  }
};

start();

const timeouts = [
  { roomId: 1, timeoutId: null, timeoutStarted: false },
  { roomId: 2, timeoutId: null, timeoutStarted: false },
  { roomId: 3, timeoutId: null, timeoutStarted: false },
  { roomId: 4, timeoutId: null, timeoutStarted: false },
  { roomId: 5, timeoutId: null, timeoutStarted: false },
];

// web sockets для подключения к играм
app.ws("/game", (ws, req) => {
  ws.on("message", async (msg) => {
    msg = JSON.parse(msg);

    switch (msg.method) {
      case "connectGeneral":
        console.log(msg);
        broadcastMenu(ws, msg);
        // отправка игроку об онлайне в меню
        let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
        let roomsMsg = { rooms: rooms };
        roomsMsg.method = "allRoomsOnline";
        ws.send(JSON.stringify(roomsMsg));

        // roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });

        // отправка игроку о джекпотах в меню
        let roomsJackpots = await roomsFunctions.checkAllJackpots();

        let roomsJackpotsMsg = { jackpots: roomsJackpots };
        roomsJackpotsMsg.method = "updateAllRoomsJackpot";
        ws.send(JSON.stringify(roomsJackpotsMsg));

        // roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
        //   jackpots: roomsJackpots,
        // });
        // отправка всем о ставке в меню
        let roomsBet = await roomsFunctions.checkAllBets();
        let roomsBetMsg = { bank: roomsBet };
        roomsBetMsg.method = "updateAllRoomsBank";
        ws.send(JSON.stringify(roomsBetMsg));

        // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });

        // отправка всем о начале игры в меню
        let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        let roomsStartTimerMsg = { timers: roomsStartTimer };
        roomsStartTimerMsg.method = "allRoomsStartTimers";
        ws.send(JSON.stringify(roomsStartTimerMsg));

        // roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
        //   timers: roomsStartTimer,
        // });

        // отправка всем о конце игры в меню
        let roomsFinishTimer = await roomsFunctions.getAllRoomsFinishTimers();

        let roomsFinishTimerMsg = { timers: roomsFinishTimer };
        roomsFinishTimerMsg.method = "allRoomsFinishTimers";
        ws.send(JSON.stringify(roomsFinishTimerMsg));

        // roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
        //   timers: roomsFinishTimer,
        // });

        // отправка всем о последнем банке в играх
        let prevBank = await roomsFunctions.getAllPrevBets();

        let prevBankMsg = { prevBank: prevBank };
        prevBankMsg.method = "updateAllRoomsPrevBank";
        ws.send(JSON.stringify(prevBankMsg));

        // roomsFunctions.sendAll(aWss, "updateAllRoomsPrevBank", {
        //   prevBank: prevBank,
        // });

        break;
      case "getAllInfo":
        // отправка всем об онлайне в меню
        let allRoomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
        roomsFunctions.sendAll(aWss, "allRoomsOnline", {
          rooms: allRoomsOnline,
        });
        // отправка всем о джекпотах в меню
        let allRoomsJackpots = await roomsFunctions.checkAllJackpots();
        roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
          jackpots: allRoomsJackpots,
        });
        // отправка всем о ставке в меню
        let allRoomsBet = await roomsFunctions.checkAllBets();
        roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
          bank: allRoomsBet,
        });

        // отправка всем о начале игры в меню
        let allRoomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
          timers: allRoomsStartTimer,
        });

        // отправка всем о конце игры в меню
        let allRoomsFinishTimer =
          await roomsFunctions.getAllRoomsFinishTimers();
        roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
          timers: allRoomsFinishTimer,
        });

        break;

      case "connectGame":
        await gameConnectionHandler(ws, msg);

        await gameService.startRoomLobby(ws, aWss, msg);

        await gameService.checkBet(ws, aWss, msg);
        await roomsFunctions.checkJackpot(ws, aWss, msg);

        break;
      case "buyTickets":
        let isBought = await gameService.gameBuyTickets(ws, msg);
        if (isBought) {
          sendTicketsToClient(ws, msg);
          await AdminLotoService.createBot(ws, aWss, msg);
        } else {
          ws.send(JSON.stringify({ method: "buyTickets", isBought: false }));
        }
        break;
      case "cancelCard":
        const cardId = msg.cardId;
        await LotoCard.update({ isActive: false }, { where: { id: cardId } });
    }
  });

  ws.on("close", async (status, msg) => {
    if (status > 1000) {
      // let roomOnline = await checkPeopleOnline();
      // let gameStates = await LotoGame.findAll();

      // for (const game of gameStates) {
      //   if (
      //     game.bots > 0 &&
      //     Boolean(game.isStarted) == false &&
      //     Boolean(game.isWaiting) == false
      //   ) {
      //     await lotoAdminService.deleteBots(roomOnline);
      //   }
      // }

      // removeTimeout(roomOnline);

      // обновить онлайн во всех комнатах на клиенте
      let roomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
      roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: roomsOnline });

      // // отправка всем о ставке в меню
      // let roomsBet = await roomsFunctions.checkAllBets();
      // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });

      return;
    }
    msg = JSON.parse(msg);
    await gameDisconnectHandler(ws, msg);
    // отправка всем о начале игры в меню
    let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
    roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
      timers: roomsStartTimer,
    });
  });
});

const gameDisconnectHandler = async (ws, msg) => {
  switch (msg.method) {
    // case "exitGame":
    //   await LotoCard.destroy({ where: { userId: msg.userId } });
    //   break;
    case "disconnectGame":
      ws.roomId = msg.roomId;
      await gameService.checkBet(ws, aWss, msg);
      await roomsFunctions.checkJackpot(ws, aWss, msg);

      let roomOnline = await checkPeopleOnline(msg.roomId);
      // if (roomOnline == 0) {
      //   removeTimeout(roomOnline, msg.roomId);
      //   await lotoAdminService.deleteBots(roomOnline, msg.roomId);
      // }
      // отправка всем о ставке в меню
      // let roomsBet = await roomsFunctions.checkAllBets();
      // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
      // await AdminLotoService.deleteBot(ws, aWss, msg);
      broadcastGame(ws, msg);
      break;
  }
};

function removeTimeout(roomOnline, roomId = null) {
  if (roomId) {
    let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
    clearTimeout(timeout.timeoutId);
  } else {
    for (let room = 1; room <= 5; room++) {
      const roomId = room;
      if (roomOnline[`room${roomId}`] === 0) {
        let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
        clearTimeout(timeout.timeoutId);
      }
    }
  }
}

const sendTicketsToClient = async (ws, msg) => {
  ws.username = msg.user;
  for (const client of aWss.clients) {
    if (client.username == msg.user) {
      client.send(JSON.stringify(msg));
    }
  }

  await gameService.checkBet(ws, aWss, msg);
  await roomsFunctions.checkJackpot(ws, aWss, msg);

  // отправка всем о джекпотах в меню
  let roomsJackpots = await roomsFunctions.checkAllJackpots();
  roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
    jackpots: roomsJackpots,
  });

  // отправка всем о ставке в меню
  let roomsBet = await roomsFunctions.checkAllBets();
  roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
};

const checkPeopleOnline = async (roomId = null) => {
  if (roomId) {
    let roomOnline = 0;
    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        roomOnline++;
      }
    });

    // if (roomOnline == 0) {
    //   // await LotoGame.update(
    //   //   { startedAt: null, isStarted: false, isWaiting: false },
    //   //   {
    //   //     where: { gameLevel: roomId },
    //   //   }
    //   // );
    //   // await LotoCard.destroy({
    //   //   where: { gameLevel: roomId },
    //   // });
    // }

    return roomOnline;
  } else {
    let rooms = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    for (let room = 1; room <= 5; room++) {
      const roomId = room;

      // get every room online
      roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == roomId) {
          roomOnline++;
        }
      });

      rooms[`room${roomId}`] = roomOnline;
    }
    return rooms;
  }
};

const gameConnectionHandler = async (ws, msg) => {
  ws.roomId = msg.roomId;
  ws.userId = msg.userId;
  ws.username = msg.username;
  broadcastGame(ws, msg);
};

const broadcastGame = async (ws, msg) => {
  let userCounter = 0;
  aWss.clients.forEach((client) => {
    if (client.username == msg.username) {
      userCounter++;
      disconnectexistingClient(userCounter, client);
    }
  });

  // получение информации об игре
  const game = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });
  let roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);

  let isJackpotPlaying = false;
  if (game.jackpot > roomComminsionInfo.jackpotAnimationSum) {
    isJackpotPlaying = true;
  }

  // get room online
  let roomOnline = 0;
  let users = [];
  aWss.clients.forEach((client) => {
    if (client.roomId == msg.roomId) {
      users.push(client.username);
      roomOnline++;
    }
  });

  roomOnline += game.bots;

  let bank = await roomsFunctions.checkRoomBet(msg.roomId);

  // отправка информации на клиентов в комнате
  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      msg.online = roomOnline;
      msg.users = users;
      msg.startedAt = game.startedAt;
      msg.isJackpotPlaying = isJackpotPlaying;
      msg.bank = bank;
      client.send(JSON.stringify(msg));
    }
  }

  // отправка всем об онлайне в каждой игре
  let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
  roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });
};

function disconnectexistingClient(counter, client) {
  if (counter > 1) {
    client.close();
  }
}

// // web sockets для подключения к общей информации о комнатах на начальной странице

const broadcastMenu = async (ws, msg) => {
  ws.loginUsername = msg.username;
  ws.clientId = msg.clientId;

  // проверка сущестуют ли другие сесии с этого аккаунта
  for (const client of aWss.clients) {
    if (
      client.loginUsername == msg.username &&
      client.clientId != msg.clientId
    ) {
      let logoutMessage = {
        method: "logoutUser",
      };
      client.send(JSON.stringify(logoutMessage));
    }
  }

  for (const client of aWss.clients) {
    client.send(JSON.stringify(msg));
  }
};
