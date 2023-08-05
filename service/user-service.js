const bcrypt = require("bcrypt");
const uuid = require("uuid");
const mailService = require("./mail-service");
const tokenService = require("./token-service");
const UserDto = require("../dtos/user-dto");
const ApiError = require("../exceptions/api-error");
const { User, Role, Rate } = require("../models/db-models");

class UserService {
  async registrationUser(username, name, email, password) {
    const candidateEmail = await User.findOne({ where: { email } });
    if (candidateEmail) {
      throw ApiError.BadRequest(`Аккаунт с почтой ${email} уже существует`);
    }

    const candidateUsername = await User.findOne({ where: { username } });
    if (candidateUsername) {
      throw ApiError.BadRequest(
        `Аккаунт с никнеймом ${username} уже существует`
      );
    }
    const hashPassword = await bcrypt.hash(password, 3);

    const user = await User.create({
      name: name,
      username: username,
      email: email,
      password: hashPassword,
    });

    const userDto = new UserDto(user); // id, email, isActivated
    const tokens = tokenService.generateTokens({ ...userDto });
    await tokenService.saveToken(userDto.id, tokens.refreshToken);

    return { ...tokens, user: userDto };
  }

  async login(username, password) {
    const user = await User.findOne({ where: { username: username } });
    if (!user) {
      throw ApiError.BadRequest(
        `Аккаунт с юзернеймом ${username} не существует`
      );
    }
    const isPassEquals = await bcrypt.compare(password, user.password);
    if (!isPassEquals) {
      throw ApiError.BadRequest("Неверный пароль");
    }
    const userDto = new UserDto(user);
    const tokens = tokenService.generateTokens({ ...userDto });

    await tokenService.saveToken(userDto.id, tokens.refreshToken);
    return { ...tokens, user: userDto };
  }

  async logout(refreshToken) {
    const token = await tokenService.removeToken(refreshToken);
    return token;
  }

  async checkAuth(req, res, next) {
    const authorizationHeader = req.headers.authorization;
    const accessToken = authorizationHeader.split(" ")[1];
    const userData = tokenService.validateAccessToken(accessToken);
    const user = await User.findOne({ where: { id: userData.id } });
    return user;
  }

  // async refresh(refreshToken) {
  //   if (!refreshToken) {
  //     throw ApiError.UnauthorizedError();
  //   }
  //   const userData = tokenService.validateRefreshToken(refreshToken);
  //   const tokenFromDb = await tokenService.findToken(refreshToken);
  //   if (!userData || !tokenFromDb) {
  //     throw ApiError.UnauthorizedError();
  //   }
  //   const user = await User.findById(userData.id);
  //   const userDto = new UserDto(user);
  //   const tokens = tokenService.generateTokens({ ...userDto });

  //   await tokenService.saveToken(userDto.id, tokens.refreshToken);
  //   return { ...tokens, user: userDto };
  // }

  async getAllUsers() {
    const users = await User.find();
    return users;
  }
}

module.exports = new UserService();
