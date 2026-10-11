-- One-time migration for shared authentication-attempt throttling.
-- Back up the database and stop the API before running this script. Do not run it twice.
USE opsmitra;

CREATE TABLE auth_attempt_limits (
  client_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempt_count INT UNSIGNED NOT NULL,
  INDEX idx_auth_attempt_limits_window (window_started_at)
) ENGINE=InnoDB;