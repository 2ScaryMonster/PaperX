from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def forwards(apps, schema_editor):
    Watchlist = apps.get_model('watchlist', 'Watchlist')
    WatchlistItem = apps.get_model('watchlist', 'WatchlistItem')

    for item in WatchlistItem.objects.all().iterator():
        default_watchlist, _ = Watchlist.objects.get_or_create(user_id=item.user_id, name='My Watchlist')
        item.watchlist_id = default_watchlist.id
        item.save(update_fields=['watchlist'])


def backwards(apps, schema_editor):
    WatchlistItem = apps.get_model('watchlist', 'WatchlistItem')
    for item in WatchlistItem.objects.select_related('watchlist').all().iterator():
        item.user_id = item.watchlist.user_id
        item.save(update_fields=['user'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('watchlist', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Watchlist',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='watchlists', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['name'],
                'unique_together': {('user', 'name')},
            },
        ),
        migrations.AddField(
            model_name='watchlistitem',
            name='watchlist',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='items', to='watchlist.watchlist'),
        ),
        migrations.RunPython(forwards, backwards),
        migrations.AlterUniqueTogether(
            name='watchlistitem',
            unique_together={('watchlist', 'symbol')},
        ),
        migrations.RemoveField(
            model_name='watchlistitem',
            name='user',
        ),
        migrations.AlterField(
            model_name='watchlistitem',
            name='watchlist',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='watchlist.watchlist'),
        ),
    ]
