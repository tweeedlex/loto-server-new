const { Loto, User, LotoCard, LotoGame } = require("../models/db-models");

class GameService {
  async startLotoGame(roomId) {
    try {
      const casks = generateCasks();
      const lotos = await Loto.findAll({ where: { gameLevel: roomId } });
      let lotoCardsArray = [];
      for (const loto of lotos) {
        const lotoCards = await LotoCard.findAll({
          where: { lotoId: loto.id },
        });
        lotoCards.forEach((lotoCard) => {
          let lotoCardInfo = {};
          (lotoCardInfo.id = lotoCard.id),
            (lotoCardInfo.card = JSON.parse(lotoCard.card));
          lotoCardsArray.push(lotoCardInfo);
        });
      }

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

      indexesArray.forEach((ticketIndexes) => {
        let max = 0;
        ticketIndexes.cellsArrayIds.forEach((cellId) => {
          if (cellId > max) {
            max = cellId;
          }
        });
        ticketIndexes.cellsArrayIds = max;
      });

      // find ids of tickets with min cellsArrayIds and receive ids of winners

      let min = indexesArray[0].cellsArrayIds;
      let winnersIds = [];
      indexesArray.forEach((ticketIndexes) => {
        if (ticketIndexes.cellsArrayIds < min) {
          min = ticketIndexes.cellsArrayIds;
        }
      });

      indexesArray.forEach((ticketIndexes) => {
        if (ticketIndexes.cellsArrayIds === min) {
          winnersIds.push(ticketIndexes.id);
        }
      });

      return { casks, winnersIds, lastIndex: min };
    } catch (error) {
      console.log(error);
    }
  }
}

module.exports = new GameService();

// ищем 2+ одинаковых карточки у игроков
// const duplicateIds = findDuplicateArrays(indexesArray);

// if (duplicateIds.length > 0) {
//   console.log("");
//   console.log(duplicateIds);
// } else {
//   console.log("");
// }
// function areArraysEqual(arr1, arr2) {
//   if (arr1.length !== arr2.length) {
//     return false;
//   }

//   for (let i = 0; i < arr1.length; i++) {
//     if (arr1[i] !== arr2[i]) {
//       return false;
//     }
//   }

//   return true;
// }

// function findDuplicateArrays(arr) {
//   const duplicateIds = [];

//   for (let i = 0; i < arr.length - 1; i++) {
//     for (let j = i + 1; j < arr.length; j++) {
//       if (areArraysEqual(arr[i].cellsArrayIds, arr[j].cellsArrayIds)) {
//         if (!duplicateIds.includes(arr[i].id)) {
//           duplicateIds.push(arr[i].id);
//         }
//         if (!duplicateIds.includes(arr[j].id)) {
//           duplicateIds.push(arr[j].id);
//         }
//       }
//     }
//   }

//   return duplicateIds;
// }

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
