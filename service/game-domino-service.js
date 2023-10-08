const { random } = require("../db");
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
const axios = require("axios");
const { literal, where } = require("sequelize");

class dominoGameService {
  // aWss,
  // msg.dominoRoomId,
  // msg.tableId,
  // msg.playerMode,
  // firstPlayerId,
  // turnTime

  async startLobby(ws, aWss, msg, startTurn) {
    // console.log("startDominoLobby");

    // получаем игру
    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.dominoRoomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    // если игра началась то прерываемся
    if (dominoGame.isStarted) {
      return;
    }

    let date = await axios.get(
      "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const time = new Date(date.data.dateTime).getTime();

    // add record to db
    await DominoGame.update(
      { startedAt: time },
      {
        where: {
          tableId: msg.tableId,
          roomId: msg.dominoRoomId,
          playerMode: msg.playerMode,
          gameMode: msg.gameMode,
        },
      }
    );
    // получаем обновленную игру
    dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.dominoRoomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    // find users in this table
    const usersInThisTable = [];
    for (const client of aWss.clients) {
      if (
        client.roomId == msg.roomId &&
        client.tableId == msg.tableId &&
        client.playerMode == msg.playerMode &&
        client.gameMode == msg.gameMode
      ) {
        usersInThisTable.push({
          userId: client.userId,
          username: client.username,
        });
      }
    }
    // console.log("usersInThisTable", usersInThisTable.length, usersInThisTable);

    const betInfo = this.getDominoRoomBetInfo(msg.dominoRoomId);

    usersInThisTable.forEach(async (player) => {
      await DominoGamePlayer.create({
        userId: player.userId,
        dominoGameId: dominoGame.id,
      });
      // take money
      await User.update(
        {
          balance: literal(`balance - ${betInfo.bet}`),
        },
        {
          where: {
            id: player.userId,
          },
        }
      );
    });

    // отправляем на клиент сообщение о старте игр
    let timerMessage = {
      startedAt: time,
      tableId: msg.tableId,
      dominoRoomId: msg.dominoRoomId,
      playerMode: msg.playerMode,
      gameMode: msg.gameMode,
      dominoGameId: dominoGame.id,
      method: "startDominoTableTimerTable",
    };
    roomsFunctions.sendAll(aWss, "startDominoTableTimerMenu", timerMessage);

    timerMessage.method = "startDominoTableTimerTable";
    roomsFunctions.sendToClientsInTable(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode,
      timerMessage
    );

    const turnQueue = [];
    usersInThisTable.forEach((user) => {
      turnQueue.push(user.userId);
    });

    shuffle(turnQueue);

    // находим игрока который ходит первый
    const { playersTiles, marketTiles } = generateAndSortTiles(
      msg.playerMode,
      turnQueue
    );

    // console.log("playerTiles ", playersTiles);

    // обновляем игру и добавляем очередь ходов

    await DominoGame.update(
      { isStarted: true, turnQueue: JSON.stringify(turnQueue) },
      { where: { id: dominoGame.id } }
    );

    let gameMessage = {
      tableId: msg.tableId,
      dominoRoomId: msg.dominoRoomId,
      playerMode: msg.playerMode,
      gameMode: msg.gameMode,
    };
    roomsFunctions.sendAll(aWss, "startDominoGameMenu", gameMessage);

    // создаем базар в базу даных на комнату и стол

    date = await axios.get(
      "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const turnTime = new Date(date.data.dateTime).getTime();

    await createMarketInRoom(
      msg.tableId,
      msg.dominoRoomId,
      msg.playerMode,
      msg.gameMode,
      marketTiles
    );

    // создаем пользователям костяшки
    await createPlayersTiles(aWss, msg, playersTiles, dominoGame);

    // отправляем информацию о начале игры
    // players= [{username: '2voby', tiles: [], score: 0}, {username: '2voby', tiles: [], score: 0}]
    // [{username: '2voby', userId: 1, tiles: [], score: 0}, {}}]

    const players = await DominoGamePlayer.findAll({
      where: { dominoGameId: dominoGame.id },
    });
    usersInThisTable.forEach((user) => {
      players.forEach((player) => {
        if (user.userId == player.userId) {
          user.tiles = JSON.parse(player.tiles);
          user.score = 0;
        }
      });
    });

    const firstPlayerId = playersTiles.find((player) => player.isFirst).userId;

    // запускаем ожидание до старта игры

    setTimeout(async () => {
      gameMessage.players = usersInThisTable;
      gameMessage.market = marketTiles;
      gameMessage.turn = firstPlayerId;
      gameMessage.turnTime = turnTime;
      gameMessage.method = "startDominoGameTable";

      // запускаем отчет следующего хода

      await startTurn(
        aWss,
        msg.dominoRoomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode,
        firstPlayerId,
        turnTime
      );

      // отправляем сообщение всем игрокам в комнате о начале игры
      roomsFunctions.sendToClientsInTable(
        aWss,
        msg.dominoRoomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode,
        gameMessage
      );

      // await this.startGame(ws, aWss);
    }, 10000);
  }

  async placeTile(ws, aWss, msg) {
    console.log("placeTile " + msg);
    let tile = msg.tile;
    let sisterTile = msg.sisterTile;
    let isPlaced = false;

    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.roomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    const scene = JSON.parse(dominoGame.scene);

    if (scene.length == 0) {
      if (tile.left == tile.right) {
        scene.push({
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: true,
        });
        await dominoGame.update({ scene: JSON.stringify(scene) });
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    if (scene.length == 1) {
      let centralTile = scene[0];

      if (centralTile.right == tile.left || centralTile.right == tile.right) {
        await addTileToRight(
          tile,
          centralTile,
          dominoGame,
          scene,
          centralTile.right == tile.right
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    if (scene.length >= 2) {
      let rightTile = scene[scene.length - 1];
      let leftTile = scene[0];

      if (sisterTile && sisterTile == "right") {
        if (rightTile.right == tile.left || rightTile.right == tile.right) {
          await addTileToRight(
            tile,
            rightTile,
            dominoGame,
            scene,
            rightTile.right == tile.right
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          isPlaced = true;
          return isPlaced;
        }
      } else if (sisterTile && sisterTile == "left") {
        if (leftTile.left == tile.right || leftTile.left == tile.left) {
          await addTileToLeft(
            tile,
            leftTile,
            dominoGame,
            scene,
            leftTile.left == tile.left
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );

          isPlaced = true;
          return isPlaced;
        }
      }

      if (rightTile.right == tile.left || rightTile.right == tile.right) {
        await addTileToRight(
          tile,
          rightTile,
          dominoGame,
          scene,
          rightTile.right == tile.right
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );

        isPlaced = true;
        return isPlaced;
      } else if (leftTile.left == tile.right || leftTile.left == tile.left) {
        await addTileToLeft(
          tile,
          leftTile,
          dominoGame,
          scene,
          leftTile.left == tile.left
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    return isPlaced;
  }

  async placeTileOnSkippedTurn(aWss, dominoGamePast, turn) {
    let dominoGame = dominoGamePast;
    let roomId = dominoGame.roomId;
    let tableId = dominoGame.tableId;
    let playerMode = dominoGame.playerMode;
    let gameMode = dominoGame.gameMode;

    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    const playersInRoom = dominoGame.dominoGamePlayers;
    const user = playersInRoom.find((player) => player.userId == turn);
    let currWs = null;
    aWss.clients.forEach((client) => {
      if (client.userId == turn) {
        currWs = client;
      }
    });
    // console.log("currWs", currWs.userId, currWs.username);
    // console.log("currTurn & userId;", turn);
    if (currWs) {
      currWs.send(JSON.stringify({ method: "THIS_CLIENT_NOW" }));
    }
    let turnAvailable = this.isTurnAvailable(JSON.parse(user.tiles), scene);

    if (turnAvailable) {
      // find which tile to place (with lowest score) that can be placed on scene

      const tiles = JSON.parse(user.tiles);

      const leftTile = scene[0];
      const rightTile = scene[scene.length - 1];

      let tileToPlace = null;
      const availableTilesToPlace = [];

      if (scene.length == 0) {
        tiles.forEach((tile) => {
          if (tile.left == tile.right) {
            availableTilesToPlace.push(tile);
          }
        });
      } else {
        tiles.forEach((tile) => {
          if (tile.left == leftTile.left || tile.right == leftTile.left) {
            availableTilesToPlace.push(tile);
          }
          if (tile.left == rightTile.right || tile.right == rightTile.right) {
            availableTilesToPlace.push(tile);
          }
        });
      }

      if (availableTilesToPlace.length > 0) {
        tileToPlace = availableTilesToPlace[0];
        availableTilesToPlace.forEach((tile) => {
          if (tile.left + tile.right < tileToPlace.left + tileToPlace.right) {
            tileToPlace = tile;
          }
        });
      }

      if (tileToPlace) {
        const msg = {
          tile: tileToPlace,
          sisterTile: null,
          roomId,
          tableId,
          playerMode,
          gameMode,
          userId: turn,
        };

        const isPlaced = await this.placeTile(currWs, aWss, msg);
        if (isPlaced) {
          await this.sendNewScene(
            currWs,
            aWss,
            roomId,
            tableId,
            playerMode,
            gameMode,
            turn
          );
        }
      }
    }
    if (!turnAvailable && market.length != 0) {
      // find tile that can be placed on scene in market and give to user

      let userTiles = JSON.parse(user.tiles);

      const leftTile = scene[0];
      const rightTile = scene[scene.length - 1];

      let tileToPlace = null;

      const availableTilesToPlace = [];

      market.forEach((tile) => {
        if (tile.left == leftTile.left || tile.right == leftTile.left) {
          availableTilesToPlace.push(tile);
        }
        if (tile.left == rightTile.right || tile.right == rightTile.right) {
          availableTilesToPlace.push(tile);
        }
      });

      tileToPlace = availableTilesToPlace[0];

      if (!tileToPlace) {
        return;
      }

      // delete tile from market and give to user
      userTiles.push(tileToPlace);
      market.splice(market.indexOf(tileToPlace), 1);

      // give user also few random tiles from market and delete them there

      let randomAmount = Math.floor(Math.random() * 5) + 1;

      for (let i = 0; i < randomAmount; i++) {
        if (market.length > 0) {
          let newUserTile = market[0];
          userTiles.push(newUserTile);
          market.splice(0, 1);
        }
      }

      await DominoGame.update(
        { market: JSON.stringify(market) },
        { where: { id: dominoGame.id } }
      );
      await DominoGamePlayer.update(
        { tiles: JSON.stringify(userTiles) },
        { where: { userId: turn } }
      );
      dominoGame = await DominoGame.findOne({
        where: {
          roomId,
          tableId,
          playerMode,
          gameMode,
        },
        include: DominoGamePlayer,
      });

      const msg = {
        tile: tileToPlace,
        sisterTile: null,
        roomId,
        tableId,
        playerMode,
        gameMode,
        userId: turn,
      };

      if (currWs) {
        currWs.send(
          JSON.stringify({
            method: "getMarketTile",
            tile: tileToPlace,
            dominoRoomId: roomId,
            tableId,
            playerMode,
            gameMode,
            turn: turn,
            scene: JSON.parse(dominoGame.scene),
            turnAvailable: true,
            closeMarket: true,
          })
        );
      }

      // обновляем пользователю инвентарь доминошек
      if (currWs) {
        currWs.send(
          JSON.stringify({
            method: "updateUserTiles",
            tiles: userTiles,
            turn: turn,
            scene: JSON.parse(dominoGame.scene),
            dominoRoomId: roomId,
            tableId,
            playerMode,
            gameMode,
          })
        );
      }

      // обновляем количество доминошек в базаре
      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        {
          method: "updateMarketNumber",
          marketNumber: market.length,
          player: turn,
        }
      );

      // отправляем новую сцену пользователям
      const isPlaced = await this.placeTile(currWs, aWss, msg);
      if (isPlaced) {
        await this.sendNewScene(
          currWs,
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          turn
        );
      }
    }
    dominoGame = await DominoGame.findOne({
      where: {
        roomId,
        tableId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playerTilesData = [];
    for (const player of dominoGame.dominoGamePlayers) {
      if (player.userId == turn) {
        playerTilesData.push({
          userId: player.userId,
          tilesNumber: JSON.parse(player.tiles).length,
        });
      }
    }
    // отправляем всем пользователям сколько у кого доминошек осталось
    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        playerTilesData,
        roomId,
        tableId,
        playerMode,
        gameMode,
        method: "updateEnemysTilesCount",
      }
    );
  }

  async sendNewScene(
    ws,
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    turn = null,
    dominoGameBase = null
  ) {
    let userId = null;
    let username = null;

    if (ws && ws.userId && ws.username) {
      userId = ws.userId;
      username = ws.username;
    }

    if (dominoGameBase) {
      dominoGameBase.dominoGamePlayers.forEach((player) => {
        if (player.userId == turn) {
          userId = player.userId;
          username = player.username;
        }
      });

      let message = {
        method: "updateDominoGameScene",
        scene: JSON.parse(dominoGameBase.scene),
        player: { username: username, userId: userId },
      };

      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        message
      );
      return;
    }

    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    if (!userId || !username) {
      dominoGame.dominoGamePlayers.forEach((player) => {
        if (player.userId == turn) {
          userId = player.userId;
          username = player.username;
        }
      });
    }

    const scene = JSON.parse(dominoGame.scene);
    let message = {
      method: "updateDominoGameScene",
      scene: scene,
      player: { username: username, userId: userId },
    };

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );
  }

  async giveMarketTile(ws, aWss, userId, startTurn) {
    let roomId = ws.dominoRoomId;
    let tableId = ws.tableId;
    let playerMode = ws.playerMode;
    let gameMode = ws.gameMode;

    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    let newUserTile = null;
    const user = dominoGame.dominoGamePlayers.find(
      (player) => player.userId == userId
    );
    const userTiles = JSON.parse(user.tiles);

    if (market.length > 0) {
      newUserTile = market[0];
      userTiles.push(newUserTile);
      market.splice(0, 1);
    }

    await DominoGame.update(
      { market: JSON.stringify(market) },
      { where: { id: dominoGame.id } }
    );
    await DominoGamePlayer.update(
      { tiles: JSON.stringify(userTiles) },
      { where: { userId: userId } }
    );

    dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playerTilesData = [];
    for (const player of dominoGame.dominoGamePlayers) {
      if (player.userId == userId) {
        playerTilesData.push({
          userId: player.userId,
          tilesNumber: JSON.parse(player.tiles).length,
        });
      }
    }

    // отправляем всем пользователям сколько у кого доминошек осталось
    let message = {
      playerTilesData,
      roomId,
      tableId,
      playerMode,
      gameMode,
      method: "updateEnemysTilesCount",
    };

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );

    let turnAvailable = this.isTurnAvailable(userTiles, scene, user);
    let closeMarket = false;

    if (turnAvailable) {
      closeMarket = true;
    }

    if (JSON.parse(dominoGame.market).length == 0) {
      closeMarket = true;
    }

    ws.send(
      JSON.stringify({
        method: "getMarketTile",
        tile: newUserTile,
        dominoRoomId: roomId,
        tableId: tableId,
        playerMode: playerMode,
        gameMode,
        turn: +dominoGame.turn,
        scene: JSON.parse(dominoGame.scene),
        turnAvailable: turnAvailable,
        closeMarket: closeMarket,
      })
    );

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "updateMarketNumber",
        marketNumber: market.length,
        player: userId,
      }
    );

    // тут
    if (JSON.parse(dominoGame.market).length == 0 && !turnAvailable) {
      await startTurn(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        null,
        null,
        true,
        true
      );
    }

    return;
  }

  async checkAvailableTurn(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    currentTurn,
    dominoGame,
    startTurn = null
  ) {
    // get the game scene and market
    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);

    // get the players in the room
    // console.log(dominoGame);
    const playersInRoom = dominoGame.dominoGamePlayers;

    // get the current turn user
    const user = playersInRoom.find((player) => player.userId == currentTurn);
    if (!user) {
      return;
    }
    let availableTurn = this.isTurnAvailable(JSON.parse(user.tiles), scene);
    // check the market
    console.log(availableTurn, market.length);
    if (market.length > 0 && !availableTurn) {
      for (const client of aWss.clients) {
        if (
          client.userId == user.userId &&
          client.dominoRoomId == roomId &&
          client.tableId == tableId &&
          client.playerMode == playerMode &&
          client.gameMode == gameMode
        ) {
          client.send(
            JSON.stringify({ method: "openTileMarket", market: market })
          );
        }
      }
    } else if (market.length == 0 && !availableTurn && startTurn) {
      setTimeout(async () => {
        await startTurn(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          null,
          null,
          true,
          true
        );
      }, 1500);
    }

    return;
  }

  isTurnAvailable(userTiles, scene, user = null) {
    let isTurnAvailable = false;

    // get the user tiles
    // console.log(user);

    if (typeof userTiles == "string") {
      userTiles = JSON.parse(userTiles);
    }

    if (scene.length == 0) {
      return true;
    }

    // check the user tiles
    if (userTiles.length > 0) {
      userTiles.forEach((tile) => {
        // check if the user tiles match the scene
        if (tile.left == scene[0].left || tile.right == scene[0].left) {
          isTurnAvailable = true;
        }
        if (
          tile.left == scene[scene.length - 1].right ||
          tile.right == scene[scene.length - 1].right
        ) {
          isTurnAvailable = true;
        }
      });
    }

    return isTurnAvailable;
  }

  async checkWin(aWss, roomId, tableId, playerMode, gameMode, startTurn) {
    // classic domino
    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const usersData = await User.findAll();

    const playersInRoom = dominoGame.dominoGamePlayers;
    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    let winners = [];

    // check if someone won
    playersInRoom.forEach((player) => {
      if (JSON.parse(player.tiles).length == 0) {
        winners = [
          {
            userId: player.userId,
            username: usersData.find((user) => user.id == player.userId)
              .username,
          },
        ];
      }
    });

    const playersScore = [];
    // если никого не нашли с 0 доминошек в инвентаре
    if (winners.length == 0) {
      // check if someone can make a turn
      let isTurnAvailable = false;
      playersInRoom.forEach((player) => {
        if (this.isTurnAvailable(player.tiles, scene) && !isTurnAvailable) {
          isTurnAvailable = true;
        }
      });

      if (market == 0 && !isTurnAvailable) {
        // ищем победителя по очкам

        // find score for each player
        playersInRoom.forEach((player) => {
          let score = 0;
          JSON.parse(player.tiles).forEach((tile) => {
            score += tile.left + tile.right;
          });
          playersScore.push({ userId: player.userId, score: score });
        });

        // find the winner (player with lowest score)

        let lowestScore = 1000;

        playersScore.forEach((player) => {
          if (player.score < lowestScore) {
            lowestScore = player.score;
          }
        });

        // find all players with lowest score

        playersScore.forEach((player) => {
          if (player.score == lowestScore) {
            winners.push({
              userId: player.userId,
              username: usersData.find((user) => user.id == player.userId)
                .username,
            });
          }
        });
      }
    }

    // заканчиваем игру если режим класики
    if (winners.length > 0 && gameMode == "CLASSIC") {
      await this.endClassicDominoGame(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        winners,
        dominoGame
      );
      return true;
    }

    //  продолжаем или заканчиваем игру если режим телефон
    if (winners.length > 0 && gameMode == "TELEPHONE") {
      let continueStatus = await this.checkEndTelephoneDominoGame(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        winners
      );

      if (!continueStatus.isGameEnded) {
        // отправить что конец игры, показать попап кто залутал поинты -> через 5-10 секунд отправить перезапуск игры
        await this.continueTelephoneDominoGame(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          continueStatus.lastWinnerId,
          startTurn,
          continueStatus.lastWinnerScore
        );
        return true;
      } else if (continueStatus.isGameEnded) {
        await this.endClassicDominoGame(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          winners,
          dominoGame
        );
        return true;
      }
    }
  }
  async endClassicDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    winners,
    dominoGame
  ) {
    // send message only to winners
    aWss.clients.forEach((client) => {
      if (
        winners.map((winner) => winner.userId).includes(client.userId) &&
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(
          JSON.stringify({
            method: "winDominoGame",
            winners: winners,
          })
        );
      }
    });

    const betInfo = this.getDominoRoomBetInfo(roomId);

    // send message to all who lost
    aWss.clients.forEach((client) => {
      if (
        !winners.map((winner) => winner.userId).includes(client.userId) &&
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(
          JSON.stringify({
            method: "endDominoGame",
            winners: winners,
            lostAmount: betInfo.bet,
          })
        );
      }
    });

    // update db records

    setTimeout(async () => {
      const prize =
        ((betInfo.bet - betInfo.commission) * playerMode) / winners.length;

      aWss.clients.forEach((client) => {
        if (
          client.dominoRoomId == roomId &&
          client.tableId == tableId &&
          client.playerMode == playerMode &&
          client.gameMode == gameMode
        ) {
          client.send(
            JSON.stringify({ method: "endAndCloseDominoGame", prize })
          );
        }
      });

      // update winners balance
      winners.forEach(async (winner) => {
        const winnerUser = await User.findOne({
          where: { id: winner.userId },
        });
        await winnerUser.update({
          balance: winnerUser.balance + prize,
        });
      });

      await DominoGame.update(
        {
          startedAt: null,
          isStarted: false,
          turn: null,
          turnQueue: "[]",
          scene: "[]",
          market: "[]",
        },
        { where: { id: dominoGame.id } }
      );

      await DominoGamePlayer.destroy({
        where: { dominoGameId: dominoGame.id },
      });
    }, 10000);
  }

  async checkEndTelephoneDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    winners
  ) {
    // проверить или можем продолжить игру

    let dominoGame = await DominoGame.findOne({
      where: {
        tableId,
        roomId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    // посчитать количество очков по доминошкам у людей в конце игры
    let players = dominoGame.dominoGamePlayers;
    let playerScore = countPlayersPoints(players);

    // найти игрока с меньшим кол-вом из playersScore

    const minPlayer = playerScore.reduce((prev, curr) =>
      prev.score < curr.score ? prev : curr
    );

    // отдать ему все очки
    const allPoints =
      playerScore.reduce((prev, curr) => prev + curr.score, 0) -
      minPlayer.score;
    const newPoints = (players.find(
      (player) => player.userId == minPlayer.userId
    ).points += allPoints);
    await DominoGamePlayer.update(
      { points: newPoints },
      { where: { userId: minPlayer.userId } }
    );

    // обновляем даные в базе
    dominoGame = await DominoGame.findOne({
      where: {
        tableId,
        roomId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });
    players = dominoGame.dominoGamePlayers;

    // проверяем есть ли у когото больше 165 очков
    const winnerCandidates = players.filter((player) => player.points >= 40);
    // find winner from winnerCandidates with max points
    let winner = null;
    if (winnerCandidates.length > 0) {
      winner = winnerCandidates.reduce((prev, curr) =>
        prev.points > curr.points ? prev : curr
      );
    }

    if (winner) {
      return { isGameEnded: true, winner };
    } else {
      return {
        isGameEnded: false,
        lastWinnerId: minPlayer.userId,
        lastWinnerScore: minPlayer.score + allPoints,
      };
    }
  }

  async continueTelephoneDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    turn,
    startTurn,
    lastWinnerScore
  ) {
    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    let playersInRoom = dominoGame.dominoGamePlayers;

    let turnQueue = [turn];
    playersInRoom.forEach((player) => {
      if (player.userId != turn) {
        turnQueue.push(player.userId);
      }
    });
    // shuffle without first element
    turnQueue = shuffle(turnQueue.slice(1));
    turnQueue.unshift(turn);

    // делаем доминошки и сортируем по пользователям
    const { playersTiles, marketTiles } = generateAndSortTiles(
      dominoGame.playerMode,
      turnQueue
    );
    await DominoGame.update(
      { isStarted: true, turnQueue: JSON.stringify(turnQueue), scene: "[]" },
      { where: { id: dominoGame.id } }
    );

    // создаем базар
    await createMarketInRoom(
      tableId,
      roomId,
      playerMode,
      gameMode,
      marketTiles
    );

    await createPlayersTiles(aWss, {}, playersTiles, dominoGame);

    let gameMessage = {
      tableId,
      dominoRoomId: roomId,
      playerMode,
      gameMode,
    };

    dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    playersInRoom = dominoGame.dominoGamePlayers;

    const allUsers = await User.findAll();
    const usersInThisTable = [];
    playersInRoom.forEach((player) => {
      const userInfo = allUsers.find((user) => user.id == player.userId);
      usersInThisTable.push({
        score: player.points,
        username: userInfo.username,
        userId: player.userId,
        tiles: JSON.parse(player.tiles),
      });
    });

    gameMessage.players = usersInThisTable;
    gameMessage.market = marketTiles;
    gameMessage.turn = turn;
    gameMessage.turnTime = 0;
    gameMessage.method = "startDominoGameTable";

    const lastWinnerUsername = allUsers.find(
      (user) => user.id == turn
    ).username;

    let currentRoomClients = [];
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        currentRoomClients.push(client);
      }
    });

    // message for popup on round finish and then start new round after delay
    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "finishTelephoneRound",
        lastWinnerScore,
        lastWinnerId: turn,
        lastWinnerUsername,
      }
    );

    setTimeout(async () => {
      // // message to redraw all on client
      // if (currentRoomClients.length > 0) {
      //   currentRoomClients.forEach((ws) => {
      //     this.sendAllTableInfo(
      //       ws,
      //       roomId,
      //       tableId,
      //       playerMode,
      //       gameMode,
      //       true
      //     );
      //   });
      // }

      // начало новой очереди игры
      await startTurn(aWss, roomId, tableId, playerMode, gameMode, turn, null);

      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        gameMessage
      );
    }, 5000);
  }

  async endTelephoneDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    winners,
    dominoGame
  ) {
    console.log(
      "sdfsdhfjksadfhkasjdhfklajshfkjlsadhfkjlasdhfjksahjfasdlkjfhasdjkhfksadjlhfkjlsadhjlkfadshfkljasdhfjklsadhfkjsadhklfhadsfhalsdj"
    );
  }

  async sendAllTableInfo(
    ws,
    roomId,
    tableId,
    playerMode,
    gameMode,
    clearScene = false
  ) {
    // find all info about game
    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playersInRoom = dominoGame.dominoGamePlayers;
    const usersData = await User.findAll();

    // write usernames to playersInRoom
    playersInRoom.forEach((player) => {
      // add username to player
      player.dataValues.username = usersData.find(
        (user) => user.id == player.userId
      ).username;
      player.dataValues.score = player.points;
    });

    // find user tiles

    const userTiles = JSON.parse(
      playersInRoom.find((player) => player.userId == ws.userId).tiles
    );

    const message = {
      method: "reconnectDominoGame",
      scene: JSON.parse(dominoGame.scene),
      market: JSON.parse(dominoGame.market),
      turnQueue: JSON.parse(dominoGame.turnQueue),
      turn: +dominoGame.turn,
      turnTime: dominoGame.turnTime,
      players: playersInRoom,
      userTiles,
      roomId,
      tableId,
      playerMode,
      gameMode,
      clearScene,
      user: usersData.find((user) => user.id == ws.userId),
    };

    ws.send(JSON.stringify(message));
  }

  getDominoRoomBetInfo(roomId) {
    switch (roomId) {
      case 1:
        return {
          bet: 0.5,
          commission: 0.075,
        };
      case 2:
        return {
          bet: 1,
          commission: 0.15,
        };
      case 3:
        return {
          bet: 3,
          commission: 0.45,
        };
      case 4:
        return {
          bet: 5,
          commission: 0.75,
        };
      case 5:
        return {
          bet: 10,
          commission: 1.5,
        };
    }
  }
}
module.exports = new dominoGameService();

function countPlayersPoints(players) {
  const playerScore = [];
  players.forEach((player) => {
    let score = 0;
    JSON.parse(player.tiles).forEach((tile) => {
      score += tile.left + tile.right;
    });
    playerScore.push({
      userId: player.userId,
      score: score,
    });
  });

  return playerScore;
}

async function deleteUserInventoryTile(
  ws,
  aWss,
  tile,
  roomId,
  tableId,
  playerMode,
  gameMode,
  userId
) {
  // const userId = ws.userId;
  let dominoGame = await DominoGame.findOne({
    where: {
      tableId: tableId,
      roomId: roomId,
      playerMode: playerMode,
      gameMode,
    },
    include: DominoGamePlayer,
  });
  console.log(userId);

  const user = dominoGame.dominoGamePlayers.find(
    (player) => player.userId == +userId
  );
  console.log(user);
  const userTiles = JSON.parse(user.tiles);
  const deletedTile = userTiles.find((userTile) => +userTile.id == +tile.id);

  userTiles.splice(userTiles.indexOf(deletedTile), 1);

  // отправляем пользователю что удалили у него доминошку

  if (ws) {
    ws.send(
      JSON.stringify({
        method: "deleteInventoryTile",
        deletedTileId: deletedTile.id,
        tiles: JSON.stringify(userTiles),
      })
    );
  }

  const usersInThisTable = [];
  for (const client of aWss.clients) {
    if (
      client.roomId == roomId &&
      client.tableId == tableId &&
      client.playerMode == playerMode &&
      client.gameMode == gameMode
    ) {
      usersInThisTable.push({
        userId: client.userId,
        username: client.username,
      });
    }
  }

  await DominoGamePlayer.update(
    { tiles: JSON.stringify(userTiles) },
    { where: { userId: userId, dominoGameId: dominoGame.id } }
  );

  dominoGame = await DominoGame.findOne({
    where: {
      tableId: tableId,
      roomId: roomId,
      playerMode: playerMode,
      gameMode: gameMode,
    },
    include: DominoGamePlayer,
  });

  const playerTilesData = [];
  for (const player of dominoGame.dominoGamePlayers) {
    if (player.userId == userId) {
      playerTilesData.push({
        userId: player.userId,
        tilesNumber: JSON.parse(player.tiles).length,
      });
    }
  }

  // отправляем всем пользователям сколько у кого доминошек осталось
  let message = {
    playerTilesData,
    roomId,
    tableId,
    playerMode,
    gameMode,
    method: "updateEnemysTilesCount",
  };

  roomsFunctions.sendToClientsInTable(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    message
  );
}

async function addTileToLeft(tile, leftTile, dominoGame, scene, inversed) {
  if (leftTile.rotate) {
    if (inversed) {
      scene.unshift({
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      });
    } else {
      scene.unshift({
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      });
    }
  } else {
    if (tile.left == tile.right) {
      scene.unshift({
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      });
    } else {
      if (inversed) {
        scene.unshift({
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        });
      } else {
        scene.unshift({
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        });
      }
    }
  }
  await dominoGame.update({ scene: JSON.stringify(scene) });
}

async function addTileToRight(tile, rightTile, dominoGame, scene, inversed) {
  if (rightTile.rotate) {
    if (inversed) {
      scene.push({
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      });
    } else {
      scene.push({
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      });
    }
  } else {
    if (tile.left == tile.right) {
      scene.push({
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      });
    } else {
      if (inversed) {
        scene.push({
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        });
      } else {
        scene.push({
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        });
      }
    }
  }
  await dominoGame.update({ scene: JSON.stringify(scene) });
}

function sendToUsersInTable(aWss, msg, method) {
  for (const client of aWss.clients) {
    if (
      client.roomId == msg.roomId &&
      client.tableId == msg.tableId &&
      client.playerMode == msg.playerMode &&
      client.gameMode == msg.gameMode
    ) {
      msg.method = method;
      client.send(JSON.stringify(msg));
    }
  }
}

function generateAndSortTiles(playerMode, turnQueue) {
  // console.log(1231231231231231, playerMode, turnQueue);
  // make 28 domino tiles
  let tiles = [];
  let doubleTiles = [];
  let id = 0;
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      if (i == j) {
        doubleTiles.push({ left: i, right: j, id });
      } else {
        tiles.push({ left: i, right: j, id });
      }
      id++;
    }
  }

  let playersTiles = [];
  let marketTiles = [];

  tiles = shuffle(tiles);

  if (playerMode == 2) {
    // shuffle 14 tiles between 2 players
    const randomDouble1 =
      doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
    playersTiles.push({ isFirst: false, tiles: tiles.slice(0, 6) });
    playersTiles[0].tiles.push(randomDouble1);

    const randomDouble2 =
      doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
    playersTiles.push({ isFirst: false, tiles: tiles.slice(6, 12) });
    playersTiles[1].tiles.push(randomDouble2);

    doubleTiles.splice(doubleTiles.indexOf(randomDouble1), 1);
    doubleTiles.splice(doubleTiles.indexOf(randomDouble2), 1);

    doubleTiles.forEach((tile) => {
      tiles.push(tile);
    });
    marketTiles = tiles.slice(12, 26);
  } else if (playerMode == 4) {
    // shuffle 7 tiles between 4 players
    for (let i = 0; i < 4; i++) {
      // make each player have a double tile and 6 random tiles
      const randomDouble =
        doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
      playersTiles.push({ isFirst: false, tiles: [randomDouble] });
      doubleTiles.splice(doubleTiles.indexOf(randomDouble), 1);
    }

    doubleTiles.forEach((tile) => {
      tiles.push(tile);
    });

    for (let i = 0; i < 6; i++) {
      playersTiles.forEach((playerTiles) => {
        playerTiles.tiles.push(tiles.pop());
      });
    }
  }

  // check if one of the players has double, if not - shuffle again
  let isDouble = false;

  playersTiles.forEach((playerTiles) => {
    playerTiles.tiles.forEach((tile) => {
      if (tile.left == tile.right) {
        isDouble = true;
      }
    });
  });

  if (!isDouble) {
    return generateAndSortTiles(playerMode);
  }

  // check who has lowest double and make him first
  let lowestDouble = 7;
  playersTiles.forEach((playerTiles, i) => {
    playerTiles.userId = turnQueue[i];
    playerTiles.tiles.forEach((tile) => {
      if (tile.left == tile.right && tile.left < lowestDouble) {
        lowestDouble = tile.left;
        playerTiles.isFirst = true;
      }
    });
  });

  // console.log("output: \n", playersTiles);

  return { playersTiles, marketTiles };
}

function shuffle(array) {
  // shuffle array
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

async function createMarketInRoom(
  tableId,
  roomId,
  playerMode,
  gameMode,
  marketTiles
) {
  await DominoGame.update(
    { market: JSON.stringify(marketTiles) },
    {
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
    }
  );
}

async function createPlayersTiles(aWss, msg, playersTiles, dominoGame) {
  // console.log(playersTiles, dominoGame);
  let i = 0;
  const playersInRoom = await DominoGamePlayer.findAll({
    where: {
      dominoGameId: dominoGame.id,
    },
  });
  for (const player of playersInRoom) {
    // console.log(`playersTiles[${i}]`, playersTiles[i]);
    await DominoGamePlayer.update(
      { tiles: JSON.stringify(playersTiles[i].tiles) },
      {
        where: {
          dominoGameId: dominoGame.id,
          userId: player.userId,
        },
      }
    );
    if (playersTiles[i].isFirst) {
      await DominoGame.update(
        { turn: playersTiles[i].userId },
        {
          where: {
            id: dominoGame.id,
          },
        }
      );
    }
    i++;
  }
}
