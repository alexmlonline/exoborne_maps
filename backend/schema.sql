-- Create the database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `exo-map-database`;
USE `exo-map-database`;

-- Create POIs table
CREATE TABLE IF NOT EXISTS pois (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    x VARCHAR(20) NOT NULL,
    y VARCHAR(20) NOT NULL,
    visible BOOLEAN DEFAULT TRUE,
    approved BOOLEAN DEFAULT FALSE,
    isDeleted BOOLEAN DEFAULT FALSE,
    dateAdded DATETIME NOT NULL,
    lastEdited DATETIME,
    sessionId VARCHAR(100),
    INDEX idx_approved (approved),
    INDEX idx_type (type),
    INDEX idx_session (sessionId),
    INDEX idx_deleted (isDeleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 