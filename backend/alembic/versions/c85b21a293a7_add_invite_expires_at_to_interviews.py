"""add_invite_expires_at_to_interviews

Revision ID: c85b21a293a7
Revises: add_tenant_ids
Create Date: 2026-07-08 12:13:07.387077

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c85b21a293a7'
down_revision: Union[str, Sequence[str], None] = 'add_tenant_ids'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('interviews', sa.Column('invite_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('interviews', 'invite_expires_at')
