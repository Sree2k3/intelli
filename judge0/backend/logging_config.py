import os
import logging
import sys
from typing import Optional

def setup_logging(name: str = "intellihire", level: Optional[str] = None):
    """
    Set up production-grade logging.
    Defaults to INFO level unless overridden by ENV or parameter.
    """
    log_level_str = level or os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    logger = logging.getLogger(name)
    logger.setLevel(log_level)

    # Prevent duplicate handlers if setup_logging is called multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        
        # In a real production system (JSON formatting for CloudWatch/DataDog)
        # We would use a JSON formatter here. For now, a clean readable format.
        formatter = logging.Formatter(
            '[%(asctime)s] [%(name)s] [%(levelname)s] [%(filename)s:%(lineno)d] - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

        # Add file handler for offline debugging
        try:
            log_dir = os.path.dirname(os.path.abspath(__file__))
            file_path = os.path.join(log_dir, "app.log")
            file_handler = logging.FileHandler(file_path, encoding="utf-8")
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)
            
            # Also catch and log to uvicorn/sqlalchemy standard loggers
            logging.getLogger("uvicorn").addHandler(file_handler)
            logging.getLogger("sqlalchemy.engine").addHandler(file_handler)
        except Exception:
            pass

    # Silence noisy libraries
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    return logger

# Singleton logger instance
logger = setup_logging()
