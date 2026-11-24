
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Offline Field Inspection API"

    # PostgreSQL
    postgres_db: str
    postgres_user: str
    postgres_password: str
    database_url: str

    # Authentication
    jwt_secret: str
    access_token_minutes: int = 30
    refresh_token_days: int = 7

    # CORS - read as a normal string
    cors_origins: str = "http://localhost:5173"

    # Frontend
    vite_api_base_url: str = "http://localhost:8000"

    # Admin
    admin_email: str = "admin@example.com"
    admin_password: str

    upload_dir: str = "./uploads"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def origins(self):
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


settings = Settings()  # type: ignore[call-arg]  # Values are loaded from the environment/.env by BaseSettings.
