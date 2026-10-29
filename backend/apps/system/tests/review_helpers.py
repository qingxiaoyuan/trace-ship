"""审查业务回归共用的模型与技能样本配置。"""
from apps.system.models import SystemConfig
from apps.system.review_settings import save_settings


def configure_review(data: dict):
    """先维护共享模型，再保存技能，模拟设置页两个入口。"""
    for field in ("endpoint", "model", "protocol", "api_key"):
        if field in data:
            SystemConfig.objects.update_or_create(key=f"ai_{field}", defaults={"value": data[field]})
    return save_settings({"skill": data["skill"]})
