const {
  Loto,
  User,
  LotoCard,
  LotoGame,
  LotoSetting,
  Stats,
  BotStats,
  UserGame,
  Bot,
  PlayedGame,
  DominoGame,
  DominoGamePlayer,
} = require("../models/db-models");
const lotoAdminService = require("./loto-admin-service");
const roomsFunctions = require("./loto-rooms-functions");
const dominoGameService = require("./game-domino-service");
const axios = require("axios");
const { literal, Op } = require("sequelize");

class dominoNavService {
  sendToClientsInTable(aWss, dominoRoomId, tableId, playerMode, gameMode, msg) {
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == dominoRoomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(JSON.stringify(msg));
      }
    });
  }

  async dominoRoomConnectionHandler(ws, aWss, msg, startTurn) {
    ws.playerMode = msg.playerMode;
    ws.dominoRoomId = msg.dominoRoomId;
    ws.tableId = msg.tableId;
    ws.userId = msg.userId;
    ws.username = msg.username;
    ws.gameMode = msg.gameMode;

    // get room online
    const online = this.getTableOnline(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode
    );

    let tableData = await DominoGame.findOne({
      where: {
        roomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    if (online > msg.playerMode) {
      return;
    }

    // console.log("msg.dominoRoomId", msg.dominoRoomId);

    // получаем время начала ожидания комнаты
    let time = null;
    if (online == 1 && !tableData.isStarted) {
      let date = await axios.get(
        "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      time = new Date(date.data.dateTime).getTime();

      await DominoGame.update(
        {
          startedWaitingAt: time,
        },
        {
          where: {
            roomId: msg.dominoRoomId,
            tableId: msg.tableId,
            playerMode: msg.playerMode,
            gameMode: msg.gameMode,
          },
        }
      );
    }

    tableData = await DominoGame.findOne({
      where: {
        roomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    roomsFunctions.sendAll(aWss, "connectDomino", msg);

    roomsFunctions.sendToClientsInTable(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode,
      {
        method: "waitingTableData",
        online,
        isStarted: tableData.isStarted,
        startedAt: tableData.startedAt,
        playerMode: msg.playerMode,
        dominoRoomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
        startedWaitingAt: tableData.startedWaitingAt,
      }
    );

    if (online == msg.playerMode && !tableData.isStarted) {
      dominoGameService.startLobby(ws, aWss, msg, startTurn);
    }
  }

  async getAllDominoInfo(ws = null, aWss) {
    const clientsData = [];

    aWss.clients.forEach((client) => {
      if (client.dominoRoomId && client.tableId) {
        clientsData.push({
          dominoRoomId: client.dominoRoomId,
          tableId: client.tableId,
          userId: client.userId,
          username: client.username,
          playerMode: client.playerMode,
          gameMode: client.gameMode,
        });
      }
    });

    const dominoPlayers = await DominoGamePlayer.findAll();

    // form data as in the example

    let dominoInfo = [];

    // extracting unique domino room ids
    const dominoRooms = [
      ...new Set(clientsData.map((client) => client.dominoRoomId)),
    ];
    let dominoGames = await DominoGame.findAll({
      where: {
        roomId: dominoRooms,
      },
    });

    console.log(dominoGames.map((game) => game.roomId));

    // forming data for each domino room // тут получаем инфу только с вебсокетов (в которых есть люди)
    dominoRooms.forEach((dominoRoomId) => {
      const dominoRoomData = clientsData.filter(
        (client) => client.dominoRoomId == dominoRoomId
      );
      const playerMode = dominoRoomData[0].playerMode;
      const gameMode = dominoRoomData[0].gameMode;

      // extracting unique table ids
      const tables = [
        ...new Set(dominoRoomData.map((client) => client.tableId)),
      ];
      const dominoRoom = {
        dominoRoomId,
        playerMode,
        gameMode,
        tables: [],
      };
      tables.forEach((tableId) => {
        // getting data for each table in the room
        const tableData = dominoRoomData.filter(
          (client) => client.tableId == tableId
        );
        const table = {
          tableId,
          online: tableData.length,
          players: tableData.map((client) => ({
            userId: client.userId,
            username: client.username,
          })),
          startedAt: null,
          isStarted: false,
        };
        // record from database
        const tableRecord = dominoGames.find(
          (game) =>
            game.roomId == dominoRoomId &&
            game.tableId == tableId &&
            game.playerMode == playerMode &&
            game.gameMode == gameMode
        );
        table.startedAt = tableRecord.startedAt;
        table.isStarted = tableRecord.isStarted;
        table.startedWaitingAt = tableRecord.startedWaitingAt;

        let tablePoints = dominoPlayers.filter(
          (player) => player.dominoGameId == tableRecord.id
        );
        tablePoints = tablePoints.map((player) => player.points);
        table.points = 0;
        if (tablePoints.length != 0) {
          table.points = Math.max(...tablePoints);
        }

        dominoRoom.tables.push(table);
      });
      dominoInfo.push(dominoRoom);
    });

    dominoGames = await DominoGame.findAll({
      where: {
        isStarted: true,
      },
    });
    // forming data for each domino room // тут получаем инфу только с базы (в которых нет людей)
    dominoGames.forEach((game) => {
      const dominoRoom = {
        dominoRoomId: game.roomId,
        playerMode: game.playerMode,
        gameMode: game.gameMode,
        tables: [
          {
            tableId: game.tableId,
            online: game.playerMode,
            players: [],
            startedAt: game.startedAt,
            isStarted: game.isStarted,
            startedWaitingAt: game.startedWaitingAt,
            points: 0,
          },
        ],
      };
      let tablePoints = dominoPlayers.filter(
        (player) => player.dominoGameId == game.id
      );
      tablePoints = tablePoints.map((player) => player.points);
      if (tablePoints.length != 0) {
        dominoRoom.tables[0].points = Math.max(...tablePoints);
      }
      dominoInfo.push(dominoRoom);
    });

    // if 2 objects in dominoInfo array have the same dominoRoomId, gameMode and playerMode then we need to merge them
    dominoInfo = dominoInfo.reduce((acc, cur) => {
      const index = acc.findIndex(
        (item) =>
          item.dominoRoomId == cur.dominoRoomId &&
          item.gameMode == cur.gameMode &&
          item.playerMode == cur.playerMode
      );
      if (index == -1) {
        acc.push(cur);
      } else {
        acc[index].tables = [...acc[index].tables, ...cur.tables];
      }
      return acc;
    }, []);

    // sending data to the client
    const response = {
      method: "getAllDominoInfo",
      dominoInfo,
    };
    if (ws) {
      ws.send(JSON.stringify(response));
    } else {
      roomsFunctions.sendAll(aWss, "getAllDominoInfo", response);
    }
  }

  async isDominoStarted(ws, msg) {
    try {
      let { dominoRoomId, tableId, playerMode, gameMode, userId } = msg;

      const dominoGame = await DominoGame.findOne({
        where: {
          roomId: dominoRoomId,
          tableId: tableId,
          playerMode: playerMode,
          gameMode: gameMode,
        },
        include: DominoGamePlayer,
      });

      if (
        dominoGame.startedAt != null &&
        !dominoGame.dominoGamePlayers.find((player) => player.userId === userId)
      ) {
        msg.allow = false;
        return ws.send(JSON.stringify(msg));
      }

      msg.allow = true;
      return ws.send(JSON.stringify(msg));
    } catch (e) {
      console.log(e);
    }
  }

  async removeUserFromTable(aWss, msg) {
    const { dominoRoomId, tableId, playerMode, userId, gameMode } = msg;

    console.log(dominoRoomId, tableId, playerMode, userId, gameMode);
    const dominoGame = await DominoGame.findOne({
      where: { roomId: dominoRoomId, tableId, playerMode, gameMode },
    });
    console.log(gameMode == "TELEPHONE");
    console.log(dominoGame);

    await DominoGamePlayer.destroy({
      where: { dominoGameId: dominoGame.id, userId },
    });

    const online = this.getTableOnline(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode
    );

    roomsFunctions.sendToClientsInTable(
      aWss,
      dominoRoomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "waitingTableData",
        online,
        isStarted: dominoGame.isStarted,
        startedAt: dominoGame.startedAt,
        playerMode,
      }
    );
  }

  getTableOnline(aWss, dominoRoomId, tableId, playerMode, gameMode) {
    let online = 0;
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == dominoRoomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        online++;
      }
    });

    return online;
  }

  async getAllTablesStartTimers() {
    return 0;
  }
}

module.exports = new dominoNavService();
