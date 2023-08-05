require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const router = require("./router/index");
const errorMiddleware = require("./middlewares/error-middleware");
const { Sequelize } = require("sequelize");
const { Loto, LotoGame } = require("./models/db-models");

const PORT = process.env.PORT || 5001;
const app = express();

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

    setInterval(async () => {
      let usersInRoom = await Loto.findAll();
      let room1 = [];
      let room2 = [];
      let room3 = [];
      usersInRoom.forEach((user) => {
        if (user.gameLevel == 1) {
          room1.push(user);
        }
        if (user.gameLevel == 2) {
          room2.push(user);
        }
        if (user.gameLevel == 3) {
          room3.push(user);
        }
      });

      if (room1.length == 0) {
        await LotoGame.update(
          { startedAt: null, isStarted: false, isWaiting: false },
          {
            where: { gameLevel: 1, isStarted: true },
          }
        );
      }
      if (room2.length == 0) {
        await LotoGame.update(
          { startedAt: null, isStarted: false, isWaiting: false },
          {
            where: { gameLevel: 2, isStarted: true },
          }
        );
      }
      if (room3.length == 0) {
        await LotoGame.update(
          { startedAt: null, isStarted: false, isWaiting: false },
          {
            where: { gameLevel: 3, isStarted: true },
          }
        );
      }
    }, 10000);
  } catch (e) {
    console.log(e);
  }
};

start();
