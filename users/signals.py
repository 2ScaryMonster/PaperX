from django.contrib.auth.models import Group
from django.db.models.signals import post_save
from django.dispatch import receiver
from users.models import User


@receiver(post_save, sender=User)
def assign_role_group(sender, instance, created, **kwargs):
    if not created:
        return
    group_name = 'Admins' if instance.role == 'admin' else 'Traders'
    group, _ = Group.objects.get_or_create(name=group_name)
    instance.groups.add(group)
