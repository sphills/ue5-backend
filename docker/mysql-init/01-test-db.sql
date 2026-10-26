-- Runs once, when the MySQL container is first created: a separate database for the
-- integration test (npm test with TEST_DB_NAME=game_test).
CREATE DATABASE IF NOT EXISTS game_test CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON game_test.* TO 'game'@'%';
FLUSH PRIVILEGES;
