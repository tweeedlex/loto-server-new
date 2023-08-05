const userService = require("../service/user-service");
const { validationResult } = require("express-validator");
const ApiError = require("../exceptions/api-error");
const { User } = require("../models/db-models");
const tokenService = require("../service/token-service");

class UserController {
  async registration(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(ApiError.BadRequest("Validation error", errors.array()));
      }
      const { username, name, email, password } = req.body;
      const userData = await userService.registrationUser(
        username,
        name,
        email,
        password
      );
      res.cookie("refreshToken", userData.refreshToken, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
      });
      return res.json(userData);
    } catch (e) {
      next(e);
    }
  }

  async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const userData = await userService.login(username, password);
      res.cookie("refreshToken", userData.refreshToken, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
      });
      return res.json(userData);
    } catch (e) {
      next(e);
    }
  }

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.cookies;
      const token = await userService.logout(refreshToken);
      res.clearCookie("refreshToken");
      return res.json(token);
    } catch (e) {
      next(e);
    }
  }

  // async refresh(req, res, next) {
  //   try {
  //     const { refreshToken } = req.cookies;
  //     const userData = await userService.refresh(refreshToken);
  //     res.cookie("refreshToken", userData.refreshToken, {
  //       maxAge: 30 * 24 * 60 * 60 * 1000,
  //       httpOnly: true,
  //     });
  //     return res.json(userData);
  //   } catch (e) {
  //     next(e);
  //   }
  // }

  async checkAuth(req, res, next) {
    try {
      const user = await userService.checkAuth(req, res, next);
      return res.json(user);
    } catch (e) {
      next(e);
    }
  }
}

module.exports = new UserController();
