const { Loto, User, LotoCard, LotoGame } = require("../models/db-models");

class GameService {
  async startLotoGame(ws, aWss, msg) {
    try {
      // сделать проверку сколько людей в лобби перед началом игры
      const card = await LotoCard.findAll({ where: { gameLevel: msg.roomId } });
      if (card.length < 1) {
        await LotoGame.update(
          {
            finishesAt: null,
            isStarted: false,
            isWaiting: false,
            startedAt: null,
          },
          { where: { gameLevel: msg.roomId } }
        );

        return;
      }

      // создаем порядок выпадения бочек с номерами в игре
      const casks = generateCasks();

      // получаем все билеты для комнаты
      const lotoCards = await LotoCard.findAll({
        where: { gameLevel: msg.roomId },
      });

      let lotoCardsArray = [];
      lotoCards.forEach((lotoCard) => {
        let lotoCardInfo = {};
        (lotoCardInfo.id = lotoCard.id),
          (lotoCardInfo.card = JSON.parse(lotoCard.card));
        lotoCardsArray.push(lotoCardInfo);
      });

      // ищем айди номеров в карточке у каждой карточки
      let indexesArray = [];

      lotoCardsArray.forEach((lotoCard) => {
        let cellsArrayIds = [];
        let indexesNumbersArray = {};

        for (let i = 0; i < lotoCard.card.length; i++) {
          if (casks.includes(+lotoCard.card[i])) {
            cellsArrayIds.push(casks.indexOf(+lotoCard.card[i]));
            indexesNumbersArray.id = lotoCard.id;
            indexesNumbersArray.cellsArrayIds = cellsArrayIds;
          }
        }
        indexesArray.push(indexesNumbersArray);
      });

      // find max element of each array

      // let maximums = {
      //   max1: 0,
      //   max2: 0,
      //   max3: 0,
      //   max4: 0,
      // };

      // indexesArray.forEach((ticketIndexes) => {
      //   let max = 0;
      //   ticketIndexes.cellsArrayIds.forEach((cellId) => {
      //     if (cellId > max) {
      //       max = cellId;
      //     }
      //   });

      //   ticketIndexes.cellsArrayIds = max;
      // });

      // сортируем каждый масств индексов в порядке убывания
      indexesArray.forEach((ticketIndexes) => {
        const maxNumbers = ticketIndexes.cellsArrayIds
          .slice()
          .sort((a, b) => b - a)
          .slice(0, 4);

        ticketIndexes.cellsArrayIds = maxNumbers;
      });

      let finalists = {
        winners: { index: 0, tickets: [] },
        left1: [],
        left2: [],
        left3: [],
      };
      // ищем и записываем карточку которая выйграет
      let maximums = [];
      indexesArray.forEach((ticketIndexes) => {
        maximums.push(ticketIndexes.cellsArrayIds[0]);
      });
      let minimum = Math.min(...maximums);
      indexesArray.forEach((ticketIndexes) => {
        if (ticketIndexes.cellsArrayIds[0] === minimum) {
          finalists.winners.tickets.push(ticketIndexes.id);
        }
      });
      finalists.winners.index = minimum;

      // добавляем в базу информацию когда текущая игра заканчивается.
      await LotoGame.update(
        {
          finishesAt: new Date().getTime() + minimum * 1000 + 15000,
          isStarted: true,
        },
        { where: { gameLevel: msg.roomId } }
      );

      // добавляем в массив финалистов карточки которые могут выигать через несколько ходов

      for (let i = 1; i < 4; i++) {
        indexesArray.forEach((ticketIndexes) => {
          if (ticketIndexes.cellsArrayIds[i] < minimum) {
            finalists[`left${i}`].push(ticketIndexes.cellsArrayIds[i]);
          }
        });
      }

      // {
      //   roomId: 1,
      //   bet: 20,
      //   username: 'bebra',
      //   userId: 2,
      //   method: 'connectGame',
      //   startedAt: 2023-08-09T09:38:08.000Z,
      //   online: 1,
      //   users: [ 'bebra' ]
      // }

      // отправляем месседж о начале игры

      const cards = await LotoCard.findAll({
        where: { gameLevel: msg.roomId },
      });

      roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == msg.roomId) {
          roomOnline++;
        }
      });

      // отправляем сообщение о начале игры на сервер
      await getAllRoomsFinishTimers(aWss);

      for (const client of aWss.clients) {
        if (client.roomId == msg.roomId) {
          let openGameMsg = {
            bet: msg.bet,
            online: roomOnline,
            bank: cards.length * msg.bet,
            method: "openGame",
          };
          client.send(JSON.stringify(openGameMsg));
        }
      }

      // делаем онлайн выдачу карточек и расчет времени игры
      await giveCasksOnline(
        ws,
        aWss,
        msg.roomId,
        casks,
        finalists,
        cards.length * msg.bet
      );

      console.log(JSON.stringify({ casks, finalists }));
    } catch (error) {
      console.log(error);
    }
  }

  async createCards(ws, msg) {
    try {
      let userId = msg.userId;
      let tickets = msg.tickets;

      await LotoCard.destroy({ where: { userId: userId } });

      let playerCandidate = await Loto.findOne({ where: { userId: userId } });
      if (!playerCandidate) {
        return res.status(400).json("You are not in the game room!!!");
      }

      const user = await User.findOne({ where: { id: userId } });
      const loto = await Loto.findOne({ where: { userId: user.id } });

      cards.forEach(async (cardArray) => {
        await LotoCard.create({
          userId: user.id,
          card: JSON.stringify(cardArray),
          lotoId: loto.id,
        });
      });

      return res.status(200).json("Вы купили карточку");
    } catch (e) {
      console.log(e);
    }
  }

  async gameBuyTickets(ws, msg) {
    try {
      let tickets = msg.tickets;
      for (let i = 0; i < tickets.length; i++) {
        await LotoCard.create({
          id: tickets[i].ticketId,
          userId: msg.userId,
          card: JSON.stringify(tickets[i].ticketCells),
          gameLevel: msg.roomId,
        });
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new GameService();

async function giveCasksOnline(ws, aWss, roomId, casks, finalists, bank) {
  let winnerCaskId = finalists.winners.index;
  let left1Ids = finalists.left1;
  let left2Ids = finalists.left2;
  let left3Ids = finalists.left3;

  sendCasksWithDelay(casks, winnerCaskId, roomId);
  function sendCasksWithDelay(casks, winnerCaskId, roomId) {
    let index = 0;

    let left3Cask = 0;
    let left2Cask = 0;
    let left1Cask = 0;
    async function sendNextCask() {
      if (index < casks.length) {
        const cask = casks[index];

        let caskMessage = {
          method: "sendNewCask",
          cask: cask,
        };
        broadcastGame(aWss, roomId, caskMessage);

        // проверка на победителя
        if (casks.indexOf(cask) === winnerCaskId) {
          let winMessage = {
            method: "winGame",
            winners: finalists.winners.tickets,
            bank: bank,
          };

          // добавление баланса в базу

          // отправка сообщения на клиент
          broadcastGame(aWss, roomId, winMessage);

          setTimeout(async () => {
            // удалить все сокеты
            for (const client of aWss.clients) {
              if (client.roomId == roomId) {
                client.close();
              }
            }

            // сбросить информацию о комнате
            await LotoGame.update(
              {
                finishesAt: null,
                isStarted: false,
                isWaiting: false,
                startedAt: null,
              },
              { where: { gameLevel: roomId } }
            );

            await LotoCard.destroy({ where: { gameLevel: roomId } });

            // отправляем сообщение об онлайне всем клиентам
            let allRoomsOnline = getAllRoomsOnline(aWss);
            let generalRoomsMessage = {
              rooms: allRoomsOnline,
              method: "allRoomsOnline",
            };
            broadcastMenu(aWss, generalRoomsMessage);

            // отправляем сообщение о банке всем клиентам
            let allRoomsBank = checkAllBets(aWss);

            // broadcastMenu(aWss, generalBankMessage);
          }, 10000);
          return;
        }

        // проверка осталось ли у когото 3 карточки

        // count how much elements of left3Ids are less than casks.indexOf(cask)
        let leftSomeMessage3 = {
          method: "leftSome",
          type: "left3",
          left3: left3Ids.filter((id) => +id <= +casks.indexOf(cask)).length,
          caskIndex: left3Ids
            .filter((id) => id < casks.indexOf(cask))
            .sort((a, b) => a - b)[0],
        };
        broadcastGame(aWss, roomId, leftSomeMessage3);
        // проверка осталось ли у когото 2 карточки
        let leftSomeMessage2 = {
          method: "leftSome",
          type: "left2",
          left2: left2Ids.filter((id) => +id <= +casks.indexOf(cask)).length,
          caskIndex: left2Ids
            .filter((id) => id < casks.indexOf(cask))
            .sort((a, b) => a - b)[0],
        };
        broadcastGame(aWss, roomId, leftSomeMessage2);
        // проверка осталось ли у когото 1 карточки
        let leftSomeMessage1 = {
          method: "leftSome",
          type: "left1",
          left1: left1Ids.filter((id) => +id <= +casks.indexOf(cask)).length,
          caskIndex: left1Ids
            .filter((id) => id < casks.indexOf(cask))
            .sort((a, b) => a - b)[0],
        };
        broadcastGame(aWss, roomId, leftSomeMessage1);

        index++;
        setTimeout(sendNextCask, 1000); // 2-second delay
      }
    }

    sendNextCask(); // Start the process
  }
}

function broadcastGame(aWss, roomId, message) {
  for (const client of aWss.clients) {
    if (client.roomId == roomId) {
      client.send(JSON.stringify(message));
    }
  }
}
function broadcastMenu(aWss, message) {
  for (const client of aWss.clients) {
    client.send(JSON.stringify(message));
  }
}

async function getAllRoomsFinishTimers(aWss) {
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

const getAllRoomsOnline = (aWss) => {
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

const checkAllBets = async (aWss) => {
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

function generateRandomNumbersWithoutRepeats(min, max, count) {
  if (count > max - min + 1) {
    throw new Error("Can't generate random numbers without repeats");
  }

  let numbers = [];
  while (numbers.length < count) {
    let randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!numbers.includes(randomNumber)) {
      numbers.push(randomNumber);
    }
  }

  return numbers;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateCasks() {
  const numbersPerRow = 90;
  const minNumber = 1;
  const maxNumber = 90;
  const totalNumbers = 90;

  let lotoCard = [];

  let rowNumbers = generateRandomNumbersWithoutRepeats(
    minNumber,
    maxNumber,
    totalNumbers
  );
  lotoCard.push(rowNumbers);

  for (let i = lotoCard[0].length; i < numbersPerRow; i++) {
    lotoCard[0].push(" ");
  }

  return shuffleArray(lotoCard[0]);
}
