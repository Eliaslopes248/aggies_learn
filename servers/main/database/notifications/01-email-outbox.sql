CREATE TABLE email_outbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings (id),
    recipient_id BIGINT NOT NULL,
    FOREIGN KEY (recipient_id) REFERENCES accounts (id),
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('booking_confirmed', 'booking_canceled')),
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    next_attempt_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    sent_at DATETIME(6),
    UNIQUE (booking_id, recipient_id, event_type)
) ENGINE=InnoDB;

CREATE INDEX pending_email_delivery
    ON email_outbox (sent_at, next_attempt_at, id);
