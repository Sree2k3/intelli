"""
Alembic Migration Script to add tenant_id to all relevant domain tables.
Run this script within your Alembic environment to apply the schema changes.

Revision ID: add_tenant_ids
Revises: 
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_tenant_ids'
down_revision = None
branch_labels = None
depends_on = None

from sqlalchemy.engine import reflection

# helper functions to check existence
def column_exists(table_name, column_name, insp):
    try:
        columns = [c['name'] for c in insp.get_columns(table_name)]
        return column_name in columns
    except Exception:
        return False

def index_exists(table_name, index_name, insp):
    try:
        indexes = [idx['name'] for idx in insp.get_indexes(table_name)]
        return index_name in indexes
    except Exception:
        return False

def upgrade():
    bind = op.get_bind()
    insp = reflection.Inspector.from_engine(bind)

    # 1. Add tenant_id columns if they don't exist
    if not column_exists('interview_messages', 'tenant_id', insp):
        op.add_column('interview_messages', sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True))
    if not column_exists('code_submissions', 'tenant_id', insp):
        op.add_column('code_submissions', sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True))
    if not column_exists('coding_questions', 'tenant_id', insp):
        op.add_column('coding_questions', sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True))
    if not column_exists('interview_questions', 'tenant_id', insp):
        op.add_column('interview_questions', sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True))

    # 2. Create indexes for optimization if they don't exist
    if not index_exists('interview_messages', 'idx_interview_messages_tenant_id', insp):
        op.create_index('idx_interview_messages_tenant_id', 'interview_messages', ['tenant_id'])
    if not index_exists('code_submissions', 'idx_code_submissions_tenant_id', insp):
        op.create_index('idx_code_submissions_tenant_id', 'code_submissions', ['tenant_id'])
    if not index_exists('coding_questions', 'idx_coding_questions_tenant_id', insp):
        op.create_index('idx_coding_questions_tenant_id', 'coding_questions', ['tenant_id'])
    if not index_exists('interview_questions', 'idx_interview_questions_tenant_id', insp):
        op.create_index('idx_interview_questions_tenant_id', 'interview_questions', ['tenant_id'])


def downgrade():
    bind = op.get_bind()
    insp = reflection.Inspector.from_engine(bind)

    # 1. Drop indexes if they exist
    if index_exists('interview_messages', 'idx_interview_messages_tenant_id', insp):
        op.drop_index('idx_interview_messages_tenant_id', table_name='interview_messages')
    if index_exists('code_submissions', 'idx_code_submissions_tenant_id', insp):
        op.drop_index('idx_code_submissions_tenant_id', table_name='code_submissions')
    if index_exists('coding_questions', 'idx_coding_questions_tenant_id', insp):
        op.drop_index('idx_coding_questions_tenant_id', table_name='coding_questions')
    if index_exists('interview_questions', 'idx_interview_questions_tenant_id', insp):
        op.drop_index('idx_interview_questions_tenant_id', table_name='interview_questions')

    # 2. Drop columns if they exist
    if column_exists('interview_messages', 'tenant_id', insp):
        op.drop_column('interview_messages', 'tenant_id')
    if column_exists('code_submissions', 'tenant_id', insp):
        op.drop_column('code_submissions', 'tenant_id')
    if column_exists('coding_questions', 'tenant_id', insp):
        op.drop_column('coding_questions', 'tenant_id')
    if column_exists('interview_questions', 'tenant_id', insp):
        op.drop_column('interview_questions', 'tenant_id')
