require("dotenv").config();
const express = require("express");
const app = express();
const WSServer = require("express-ws")(app);
const aWss = WSServer.getWss();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const router = require("./router/index");
const errorMiddleware = require("./middlewares/error-middleware");
const { Sequelize } = require("sequelize");
const { Loto, LotoGame, LotoCard } = require("./models/db-models");
const gameService = require("./service/game-service");

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

const start = async () => {
  try {
    const sequelize = require("./db");
    await sequelize.authenticate();
    await sequelize.sync();

    app.listen(PORT, () => console.log(`Server started on PORT = ${PORT}`));

    // setInterval(async () => {
    //   let usersInRoom = await Loto.findAll();
    //   let room1 = [];
    //   let room2 = [];
    //   let room3 = [];
    //   usersInRoom.forEach((user) => {
    //     if (user.gameLevel == 1) {
    //       room1.push(user);
    //     }
    //     if (user.gameLevel == 2) {
    //       room2.push(user);
    //     }
    //     if (user.gameLevel == 3) {
    //       room3.push(user);
    //     }
    //   });

    //   if (room1.length == 0) {
    //     await LotoGame.update(
    //       { startedAt: null, isStarted: false, isWaiting: false },
    //       {
    //         where: { gameLevel: 1, isStarted: true },
    //       }
    //     );
    //   }
    //   if (room2.length == 0) {
    //     await LotoGame.update(
    //       { startedAt: null, isStarted: false, isWaiting: false },
    //       {
    //         where: { gameLevel: 2, isStarted: true },
    //       }
    //     );
    //   }
    //   if (room3.length == 0) {
    //     await LotoGame.update(
    //       { startedAt: null, isStarted: false, isWaiting: false },
    //       {
    //         where: { gameLevel: 3, isStarted: true },
    //       }
    //     );
    //   }
    // }, 10000);
  } catch (e) {
    console.log(e);
  }
};

start();

const timeouts = [
  { roomId: 1, timeoutId: null, timeoutStarted: false },
  { roomId: 2, timeoutId: null, timeoutStarted: false },
  { roomId: 3, timeoutId: null, timeoutStarted: false },
];

// web sockets для подключения к играм
app.ws("/game", (ws, req) => {
  ws.on("message", async (msg) => {
    msg = JSON.parse(msg);

    switch (msg.method) {
      case "connectGeneral":
        broadcastMenu(ws, msg);
        // отправка всем об онлайне в каждой игре
        let rooms = getAllRoomsOnline();
        for (const client of aWss.clients) {
          let generalMessage = {
            rooms: rooms,
            method: "allRoomsOnline",
          };
          client.send(JSON.stringify(generalMessage));
        }
        // отправка всем о ставке в каждой игре
        await checkAllBets();
        await getAllRoomsStartTimers();
        await getAllRoomsFinishTimers();
        break;

      case "connectGame":
        let timerStarted = await isTimerStarted(msg);
        if (!timerStarted) {
          // find timeout with id of roomid
          let timeout = timeouts.find(
            (timeout) => timeout.roomId == msg.roomId
          );
          timeout.timeoutStarted = true;
          timeout.timeoutId = setTimeout(async () => {
            await gameService.startLotoGame(ws, aWss, msg);
          }, 30000);
        }
        await gameConnectionHandler(ws, msg);
        await checkBet(msg);
        await checkAllBets();
        break;
      case "buyTickets":
        let isBought = await gameService.gameBuyTickets(ws, msg);
        if (isBought) {
          sendTicketsToClient(ws, msg);
        }
        break;
    }
  });

  ws.on("close", async (status, msg) => {
    if (status > 1000) {
      let roomOnline = await checkOnline();
      await removeTimeout(roomOnline);
      updateOnline();
      return;
    }
    msg = JSON.parse(msg);
    await gameDisconnectHandler(ws, msg);
    await getAllRoomsStartTimers();
  });
});

const gameDisconnectHandler = async (ws, msg) => {
  ws.roomId = msg.roomId;

  // await LotoCard.destroy({
  //   where: { userId: msg.userId },
  // });

  await checkBet(msg);
  await checkAllBets();
  let roomOnline = await checkOnline(msg.roomId);
  if (roomOnline == 0) {
    await removeTimeout(roomOnline, msg.roomId);

    // let lotoGameInfo = await LotoGame.findOne({
    //   where: { gameLevel: msg.roomId },
    // });

    // if (lotoGameInfo.isStarted == true) {
    //   return;
    // }

    // await LotoGame.update(
    //   { startedAt: null, isStarted: false, isWaiting: false },
    //   {
    //     where: { gameLevel: msg.roomId, isStarted: true },
    //   }
    // );
  }
  broadcastGame(ws, msg);
};

async function removeTimeout(roomOnline, roomId = null) {
  if (roomId) {
    let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
    clearTimeout(timeout.timeoutId);
  } else {
    for (let room = 1; room <= 3; room++) {
      const roomId = room;
      if (roomOnline[`room${roomId}`] === 0) {
        let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
        clearTimeout(timeout.timeoutId);
      }
    }
  }
}

const checkBet = async (msg) => {
  let cardsInRoom = await LotoCard.findAll({
    where: { gameLevel: msg.roomId },
  });
  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      message = {
        method: "updateBank",
        bank: cardsInRoom.length * msg.bet,
      };
      client.send(JSON.stringify(message));
    }
  }
};

const checkAllBets = async () => {
  let roomsBet = {
    room1: 0,
    room2: 0,
    room3: 0,
  };
  for (let room = 1; room <= 3; room++) {
    const roomId = room;
    let bet = 0;
    switch (roomId) {
      case 1:
        bet = 20;
        break;
      case 2:
        bet = 100;
        break;
      case 3:
        bet = 300;
        break;
    }
    let cardsInRoom = await LotoCard.findAll({
      where: { gameLevel: room },
    });
    let roomBet = cardsInRoom.length * bet;
    roomsBet[`room${roomId}`] = roomBet;
  }

  for (const client of aWss.clients) {
    generalMessage = {
      method: "updateAllRoomsBank",
      bank: roomsBet,
    };
    client.send(JSON.stringify(generalMessage));
  }
};

const sendTicketsToClient = async (ws, msg) => {
  ws.username = msg.user;
  for (const client of aWss.clients) {
    if (client.username == msg.user) {
      client.send(JSON.stringify(msg));
    }
  }

  await checkBet(msg);
  await checkAllBets();
};

const checkOnline = async (roomId = null) => {
  if (roomId) {
    let roomOnline = 0;
    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        roomOnline++;
      }
    });
    if (roomOnline == 0) {
      await LotoGame.update(
        { startedAt: null, isStarted: false, isWaiting: false },
        {
          where: { gameLevel: roomId },
        }
      );
      await LotoCard.destroy({
        where: { gameLevel: roomId },
      });
    }

    return roomOnline;
  } else {
    let rooms = {
      room1: 0,
      room2: 0,
      room3: 0,
    };
    for (let room = 1; room <= 3; room++) {
      const roomId = room;
      let bet = 0;
      switch (roomId) {
        case 1:
          bet = 20;
          break;
        case 2:
          bet = 100;
          break;
        case 3:
          bet = 300;
          break;
      }
      // get every room online
      roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == roomId) {
          roomOnline++;
        }
      });

      rooms[`room${roomId}`] = roomOnline;

      if (roomOnline == 0) {
        let lotoGameInfo = await LotoGame.findOne({
          where: { gameLevel: roomId },
        });

        if (lotoGameInfo.isStarted != true) {
          await LotoGame.update(
            { startedAt: null, isStarted: false, isWaiting: false },
            {
              where: { gameLevel: roomId },
            }
          );
          await LotoCard.destroy({
            where: { gameLevel: roomId },
          });
        }
      }
    }
    return rooms;
  }
};

const gameConnectionHandler = async (ws, msg) => {
  ws.roomId = msg.roomId;
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

  // get room online
  roomOnline = 0;
  users = [];
  aWss.clients.forEach((client) => {
    if (client.roomId == msg.roomId) {
      users.push(client.username);
      roomOnline++;
    }
  });

  // запуск таймера
  let timerStarted = await startRoomTimer(msg);
  if (timerStarted) {
    msg.startedAt = timerStarted;
  }

  // получение информации об игре
  const game = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  // отправка информации на клиентов с комнаты
  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      msg.online = roomOnline;
      msg.users = users;
      msg.startedAt = game.startedAt;
      client.send(JSON.stringify(msg));
    }
  }

  // отправка всем об онлайне в каждой игре
  let rooms = getAllRoomsOnline();
  for (const client of aWss.clients) {
    let generalMessage = {
      rooms: rooms,
      method: "allRoomsOnline",
    };
    client.send(JSON.stringify(generalMessage));
  }
};

const getAllRoomsOnline = () => {
  let rooms = {
    room1: 0,
    room2: 0,
    room3: 0,
  };
  for (let room = 1; room <= 3; room++) {
    const roomId = room;
    let bet = 0;
    switch (roomId) {
      case 1:
        bet = 20;
        break;
      case 2:
        bet = 100;
        break;
      case 3:
        bet = 300;
        break;
    }
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
};

const isTimerStarted = async (msg) => {
  // get room online
  let gameState = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  if (gameState.isWaiting && gameState.startedAt != null) {
    return true;
  } else return false;
};
const startRoomTimer = async (msg) => {
  // get room online
  roomOnline = 0;
  users = [];
  aWss.clients.forEach((client) => {
    if (client.roomId == msg.roomId) {
      users.push(client.username);
      roomOnline++;
    }
  });

  let gameState = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  if (roomOnline == 1 && gameState.isWaiting == false) {
    await LotoGame.update(
      { startedAt: new Date(), isStarted: false, isWaiting: true },
      {
        where: { gameLevel: msg.roomId },
      }
    );

    await getAllRoomsStartTimers();
    return new Date();
  } else return false;
};

async function getAllRoomsStartTimers() {
  const roomTimers = {
    room1: null,
    room2: null,
    room3: null,
  };

  const rooms = await LotoGame.findAll();
  for (let gameLevel = 1; gameLevel <= 3; gameLevel++) {
    const room = rooms.find((room) => room.gameLevel == gameLevel);
    roomTimers[`room${gameLevel}`] = room.startedAt;
  }

  const timersMessage = {
    method: "allRoomsStartTimers",
    timers: roomTimers,
  };
  for (const client of aWss.clients) {
    client.send(JSON.stringify(timersMessage));
  }
}

async function getAllRoomsFinishTimers() {
  const roomTimers = {
    room1: null,
    room2: null,
    room3: null,
  };

  const rooms = await LotoGame.findAll();
  for (let gameLevel = 1; gameLevel <= 3; gameLevel++) {
    const room = rooms.find((room) => room.gameLevel == gameLevel);
    roomTimers[`room${gameLevel}`] = room.finishesAt;
  }

  const timersMessage = {
    method: "allRoomsFinishTimers",
    timers: roomTimers,
  };
  for (const client of aWss.clients) {
    client.send(JSON.stringify(timersMessage));
  }
}

const updateOnline = async () => {
  for (let room = 1; room <= 3; room++) {
    const roomId = room;
    let bet = 0;
    switch (roomId) {
      case 1:
        bet = 20;
        break;
      case 2:
        bet = 100;
        break;
      case 3:
        bet = 300;
        break;
    }
    // get every room online
    roomOnline = 0;
    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        roomOnline++;
      }
    });

    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        let msg = {
          bet: bet,
          roomId: roomId,
          method: "disconnectGame",
          online: roomOnline,
          username: "Anonymus",
        };

        client.send(JSON.stringify(msg));
      }
    });
  }
};

function disconnectexistingClient(counter, client) {
  if (counter > 1) {
    client.close();
  }
}

// // web sockets для подключения к общей информации о комнатах на начальной странице

const broadcastMenu = async (ws, msg) => {
  let rooms = {
    room1: 0,
    room2: 0,
    room3: 0,
  };
  for (let room = 1; room <= 3; room++) {
    const roomId = room;
    let bet = 0;
    switch (roomId) {
      case 1:
        bet = 20;
        break;
      case 2:
        bet = 100;
        break;
      case 3:
        bet = 300;
        break;
    }
    // get every room online
    roomOnline = 0;
    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        roomOnline++;
      }
    });

    rooms[`room${roomId}`] = roomOnline;

    // if (roomOnline == 0) {
    //   await LotoGame.update(
    //     { startedAt: null, isStarted: false, isWaiting: false },
    //     {
    //       where: { gameLevel: roomId },
    //     }
    //   );
    //   await LotoCard.destroy({
    //     where: { gameLevel: roomId },
    //   });
    // }
  }

  for (const client of aWss.clients) {
    client.send(JSON.stringify(msg));
  }
};

// app.ws("/", (ws, req) => {
//   ws.on("message", (msg) => {
//     msg = JSON.parse(msg);
//     switch (msg.method) {
//       case "connection":
//         connectionHandler(ws, msg);
//         break;
//     }
//   });
// });

// const connectionHandler = (ws, msg) => {
//   broadcastConnection(ws, msg);
// };

// const broadcastConnection = (ws, msg) => {
//   let online = 0;
//   aWss.clients.forEach((client) => {
//     online++;
//   });

//   aWss.clients.forEach((client) => {
//     msg.online = online;
//     client.send(JSON.stringify(msg));
//   });
// };
