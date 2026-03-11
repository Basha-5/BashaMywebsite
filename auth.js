/**
 * ============================================================
 * AUTH.JS — Core Authentication Module
 * Behavioral Biometrics Auth System
 * Handles user registration, login, session management
 * ============================================================
 */

const Auth = (() => {
  const USERS_KEY = 'bio_auth_users';
  const SESSION_KEY = 'bio_auth_session';

  /* ---------- Helpers ---------- */

  /** Simple SHA-256-like hash using Web Crypto */
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'BioBiometric$Salt_2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** Load all users from localStorage */
  function loadUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
    } catch { return {}; }
  }

  /** Save users to localStorage */
  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  /** Validate username */
  function validateUsername(username) {
    if (!username || username.trim().length < 3) {
      return 'Username must be at least 3 characters.';
    }
    if (username.length > 30) return 'Username must be under 30 characters.';
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return 'Only letters, numbers, _, -, and . are allowed.';
    }
    return null;
  }

  /** Validate password strength */
  function validatePassword(password) {
    if (!password || password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter.';
    if (!/[0-9]/.test(password)) return 'Include at least one number.';
    return null;
  }

  /* ---------- Public API ---------- */

  /**
   * Register a new user (Step 1 — credentials only)
   * Face descriptor is added in step 2 via updateFaceDescriptor()
   */
  async function registerUser(username, password, confirmPassword) {
    const users = loadUsers();
    const uErr = validateUsername(username);
    if (uErr) return { success: false, message: uErr };

    const pErr = validatePassword(password);
    if (pErr) return { success: false, message: pErr };

    if (password !== confirmPassword) {
      return { success: false, message: 'Passwords do not match.' };
    }

    const key = username.toLowerCase();
    if (users[key]) {
      return { success: false, message: 'Username is already taken.' };
    }

    const hashed = await hashPassword(password);
    users[key] = {
      username,
      passwordHash: hashed,
      faceDescriptor: null,
      createdAt: Date.now(),
      loginHistory: []
    };

    saveUsers(users);
    return { success: true, message: 'Credentials registered successfully.' };
  }

  /**
   * Update a user's face descriptor after face capture
   */
  function updateFaceDescriptor(username, descriptor) {
    const users = loadUsers();
    const key = username.toLowerCase();
    if (!users[key]) return { success: false, message: 'User not found.' };
    users[key].faceDescriptor = Array.from(descriptor); // store as plain array
    saveUsers(users);
    return { success: true, message: 'Face profile saved.' };
  }

  /**
   * Verify credentials only (Step 1 of login)
   */
  async function verifyCredentials(username, password) {
    const users = loadUsers();
    const key = username.toLowerCase();
    if (!users[key]) return { success: false, message: 'User not found.' };

    const hashed = await hashPassword(password);
    if (users[key].passwordHash !== hashed) {
      return { success: false, message: 'Incorrect password.' };
    }

    if (!users[key].faceDescriptor) {
      return {
        success: false,
        message: 'No face profile registered. Please re-register.'
      };
    }

    return {
      success: true,
      message: 'Credentials verified.',
      faceDescriptor: users[key].faceDescriptor,
      userData: { username: users[key].username, createdAt: users[key].createdAt }
    };
  }

  /**
   * Create a session after full (biometric) login
   */
  function createSession(username) {
    const users = loadUsers();
    const key = username.toLowerCase();
    const token = crypto.randomUUID();
    const now = Date.now();

    if (users[key]) {
      users[key].loginHistory = [
        { at: now, ip: 'local' },
        ...(users[key].loginHistory || []).slice(0, 9)
      ];
      saveUsers(users);
    }

    const session = {
      token,
      username,
      loginAt: now,
      expiresAt: now + 3600000 // 1 hour
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /**
   * Get current active session (null if expired / none)
   */
  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s) return null;
      if (Date.now() > s.expiresAt) { logout(); return null; }
      return s;
    } catch { return null; }
  }

  /**
   * Require a valid session — redirect if not present
   */
  function requireSession(redirectTo = 'login.html') {
    const s = getSession();
    if (!s) {
      window.location.href = redirectTo;
      return null;
    }
    return s;
  }

  /**
   * Redirect away from page if already logged in
   */
  function redirectIfLoggedIn(redirectTo = 'dashboard.html') {
    if (getSession()) window.location.href = redirectTo;
  }

  /**
   * Log out — clear session
   */
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /**
   * Get user data (for dashboard etc.)
   */
  function getUserData(username) {
    const users = loadUsers();
    const u = users[username.toLowerCase()];
    if (!u) return null;
    return {
      username: u.username,
      createdAt: u.createdAt,
      loginHistory: u.loginHistory || [],
      hasFace: !!u.faceDescriptor
    };
  }

  /**
   * Get all usernames (debug / admin)
   */
  function listUsers() {
    return Object.keys(loadUsers());
  }

  /**
   * Password strength meter (0–4)
   */
  function passwordStrength(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }

  return {
    registerUser,
    updateFaceDescriptor,
    verifyCredentials,
    createSession,
    getSession,
    requireSession,
    redirectIfLoggedIn,
    logout,
    getUserData,
    listUsers,
    passwordStrength,
    validateUsername,
    validatePassword
  };
})();

// Make it globally available
window.Auth = Auth;
