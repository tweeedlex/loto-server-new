const Router = require("express").Router;
const userController = require("../controllers/user-controller");
const router = new Router();
const { body } = require("express-validator");
const authMiddleware = require("../middlewares/auth-middleware");

const gameRouter = require("./game-router");

// user
router.post(
  "/registration",
  //   body("username").isEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 3, max: 32 }),
  userController.registration
);

// login

router.post("/login", userController.login);

router.post("/logout", userController.logout);

router.get("/checkAuth", authMiddleware, userController.checkAuth);

// game

router.use("/game", authMiddleware, gameRouter);

module.exports = router;
