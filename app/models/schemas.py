from pydantic import BaseModel


class MigrationCheckRequest(BaseModel):
    ple_url: str
    evona_url: str
    include_screenshots: bool = True
    include_page_scan: bool = True
    include_cta_check: bool = True
    include_ai_analysis: bool = True