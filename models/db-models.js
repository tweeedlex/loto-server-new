const sequelize = require("../db");
const { DataTypes } = require("sequelize");

const User = sequelize.define("user", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  isAdmin: { type: DataTypes.STRING, defaultValue: false },
  balance: { type: DataTypes.INTEGER, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER, defaultValue: 0 },
  losses: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Token = sequelize.define("token", {
  userId: { type: DataTypes.INTEGER },
  refreshToken: { type: DataTypes.STRING },
});

// const Room = sequelize.define("room", {
//   id: {
//     type: DataTypes.INTEGER,
//     primaryKey: true,
//     unique: true,
//     allowNull: false,
//     autoIncrement: true,
//   },
//   type: { type: DataTypes.STRING, allowNull: false },
//   bet: { type: DataTypes.INTEGER, allowNull: false },
// });

// const Game = sequelize.define("game", {
//   id: {
//     type: DataTypes.INTEGER,
//     primaryKey: true,
//     unique: true,
//     allowNull: false,
//     autoIncrement: true,
//   },
//   players: { type: DataTypes.JSON, allowNull: false },
//   winnerLotoCard: { type: DataTypes.JSON },
//   startedAt: { type: DataTypes.DATE },
//   finishedAt: { type: DataTypes.DATE },
//   status: { type: DataTypes.STRING, defaultValue: "WAITING" },
// });

// const Loto = sequelize.define("loto", {
//   id: {
//     type: DataTypes.INTEGER,
//     primaryKey: true,
//     unique: true,
//     allowNull: false,
//     autoIncrement: true,
//   },
//   gameLevel: { type: DataTypes.INTEGER, allowNull: false },
// });

const LotoCard = sequelize.define("card", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    unique: true,
    allowNull: false,
  },
  gameLevel: { type: DataTypes.INTEGER, allowNull: false },
  card: { type: DataTypes.JSON, allowNull: false },
});

const LotoGame = sequelize.define("lotoGame", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  startedAt: { type: DataTypes.DATE },
  finishesAt: { type: DataTypes.DATE },
  isStarted: { type: DataTypes.BOOLEAN, defaultValue: false },
  isWaiting: { type: DataTypes.BOOLEAN, defaultValue: false },
  gameLevel: { type: DataTypes.INTEGER, allowNull: false, unique: true },
});

User.hasMany(Token);
Token.belongsTo(User);

User.hasMany(LotoCard);
LotoCard.belongsTo(User);

// User.hasOne(Loto);
// Loto.belongsTo(User);

// Room.hasMany(Game);
// Game.belongsTo(Room);

// Game.hasMany(User);
// User.belongsTo(Game);

// Game.hasMany(LotoCard);
// LotoCard.belongsTo(Game);

module.exports = {
  User,
  Token,
  // Loto,
  LotoGame,
  LotoCard,
};
