const Session = require('../../models/session.model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const { resolve500Error } = require('./../../middlewares/validation');

const MONTH_IN_MS = 1000 * 60 * 60 * 24 * 30;
const HALF_AN_HOUR_IN_SEC = 60 * 30;
const REFRESH_TOKEN_LIFETIME = MONTH_IN_MS;
const ACCESS_TOKEN_LIFETIME = HALF_AN_HOUR_IN_SEC;

exports.ACCESS_TOKEN_LIFETIME = ACCESS_TOKEN_LIFETIME * 1000;

exports.createPasswordHash = (password) => {
  return bcrypt.hashSync(password, 8);
}

exports.createNewSession = async (user, fingerprint) => {
  const accessToken = jwt.sign(
    { id: user.id },
    process.env.SECRET_AUTH_KEY,
    { expiresIn: ACCESS_TOKEN_LIFETIME },
  );
  const refreshToken = nanoid();
  const authorities = [];

  for (let i = 0; i < user.roles.length; i++) {
    authorities.push(`ROLE_${user.roles[i].name.toUpperCase()}`);
  }

  const session = new Session({
    userId: String(user._id),
    email: user.email,
    fingerprint: fingerprint,
    accessToken,
    refreshToken,
    refreshExpiredAt: +new Date() + REFRESH_TOKEN_LIFETIME,
    createdAt: +new Date(),
  });

  await session.save();

  return { accessToken, refreshToken, authorities };
}

exports.checkIsSessionValid = async ({ userId, accessToken, refreshToken, fingerprint }) => {
  const session = await Session.findOne({ accessToken });

  const isValid = session.userId === userId
    && session.accessToken === accessToken
    && session.fingerprint === fingerprint;

  return {
    currentSession: session,
    isValid,
  };
}

exports.logout = async ({
  userId,
  accessToken,
  refreshToken,
  fingerprint,
  mode,
  isNoTokensMode = false,
}) => {
  const modeMessages = {
    'all': 'You are succesully logged out from all devices',
    'allExceptCurrent': 'You are logged out from all other devices',
    'current': 'You are successfully logged out.'
  };

  try {
    if (isNoTokensMode) {
      if (mode !== 'all') {
        return Promise.reject();
      }

      const sessions = await Session.find({ userId });

      sessions.forEach(session => {
        accessTokenBlackListStorage.add(session.accessToken);
      });

      await sessions.remove();

      return Promise.resolve({ message: modeMessages.all });
    } else {
      const { isValid, currentSession }
        = checkIsSessionValid({ userId, accessToken, refreshToken, fingerprint });

      if (isValid) {
        if (mode === 'allExceptCurrent') {
          const sessions = (await Session.find({ userId })).filter(session => {
            return String(session._id) !== String(currentSession._id);
          });

          sessions.forEach(session => {
            accessTokenBlackListStorage.add(session.accessToken);
          });

          await sessions.remove();
        }
        
        if (['all', 'current'].includes(mode)) {
          accessTokenBlackListStorage.add(currentSession.accessToken);

          await currentSession.remove();
        }

        return Promise.resolve({ message: modeMessages[mode] });
      } else {
        return Promise.reject({ message: 'The data is invalid' });
      }
    }
  } catch (err) {
    resolve500Error(err, res);
  }
}
