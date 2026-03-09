from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('trades', '0003_tradingbotconfig_tradingbotlog'),
    ]

    operations = [
        migrations.AddField(
            model_name='tradingbotconfig',
            name='strategy_prompt',
            field=models.TextField(blank=True, default=''),
        ),
    ]

