from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SCRAPERAPI_KEY:    str
    GOOGLE_AI_API_KEY: str
    PAGESPEED_API_KEY: Optional[str] = None  # Added: was missing, causing crash
    DEBUG:             bool = False

    class Config:
        env_file          = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
