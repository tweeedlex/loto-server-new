const Router = require("express").Router;
const router = new Router();
const gameController = require("../controllers/game-controller");
const authMiddleware = require("../middlewares/auth-middleware");

router.post("/connect-loto-room/:roomId", gameController.connectLotoRoom);
router.delete(
  "/disconnect-loto-room/:roomId",
  gameController.disconnectLotoRoom
);
router.delete("/clear-all", gameController.clearAll);
router.get("/is-game-started/:roomId", gameController.isGameStarted);
router.get("/get-loto-online", gameController.getOnline);

router.put("/finish-loto-waiting/:roomId", gameController.finishLotoWaiting);
router.post("/create-card", gameController.createCards);
router.get("/get-card", gameController.getCards);
router.delete("/delete-card/:cardId", gameController.deleteCard);
router.get("/get-messages", gameController.getMessages);

router.post("/test", gameController.test);
router.post("/start", authMiddleware, gameController.start);

module.exports = router;
