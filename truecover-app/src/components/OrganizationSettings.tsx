import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Organization, OrganizationMember } from '../types';
import { organizationsApi } from '../services/api';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge,
  TacticalModal,
  TacticalInput
} from '../tactical-ui';

interface OrganizationSettingsProps {
  organization: Organization | null;
  onOrganizationUpdated: (org: Organization) => void;
  onOrganizationDeleted: () => void;
}

const OrganizationSettings: React.FC<OrganizationSettingsProps> = ({
  organization,
  onOrganizationUpdated,
  onOrganizationDeleted
}) => {
  const { getToken, userId } = useAuth();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  // Add Member Modal state
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Organization Modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Organization Modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (organization) {
      loadMembers();
    } else {
      setMembers([]);
    }
  }, [organization]);

  const loadMembers = async () => {
    if (!organization) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const membersList = await organizationsApi.getMembers(organization.id, token);
      setMembers(membersList);

      // Find current user's role using Clerk ID
      const currentMember = membersList.find(m => m.clerk_id === userId);
      setCurrentUserRole(currentMember?.role || null);
    } catch (err: any) {
      console.error('Failed to load members:', err);
      setError(err.response?.data?.error || 'Failed to load members');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organization) return;
    if (!newMemberEmail.trim()) {
      setAddError('Email is required');
      return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newMemberEmail.trim())) {
      setAddError('Please enter a valid email address');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const token = await getToken();
      if (!token) {
        setAddError('Authentication required');
        return;
      }

      const newMember = await organizationsApi.addMember(
        organization.id,
        newMemberEmail.trim(),
        token
      );

      setMembers([...members, newMember]);
      setNewMemberEmail('');
      setIsAddMemberModalOpen(false);
    } catch (err: any) {
      console.error('Failed to add member:', err);
      setAddError(err.response?.data?.error || 'Failed to add member');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!organization) return;
    if (!window.confirm('Are you sure you want to remove this member?')) {
      return;
    }

    try {
      const token = await getToken();
      if (!token) return;

      await organizationsApi.removeMember(organization.id, memberId, token);
      setMembers(members.filter(m => m.id !== memberId));
    } catch (err: any) {
      console.error('Failed to remove member:', err);
      alert(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const closeAddMemberModal = () => {
    setIsAddMemberModalOpen(false);
    setNewMemberEmail('');
    setAddError(null);
  };

  const openEditModal = () => {
    if (organization) {
      setEditedName(organization.name);
      setIsEditModalOpen(true);
    }
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditedName('');
    setEditError(null);
  };

  const handleEditOrganization = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organization) return;
    if (!editedName.trim()) {
      setEditError('Organization name is required');
      return;
    }

    setIsEditing(true);
    setEditError(null);

    try {
      const token = await getToken();
      if (!token) {
        setEditError('Authentication required');
        return;
      }

      const updatedOrg = await organizationsApi.update(
        organization.id,
        editedName.trim(),
        token
      );

      onOrganizationUpdated(updatedOrg);
      closeEditModal();
    } catch (err: any) {
      console.error('Failed to update organization:', err);
      setEditError(err.response?.data?.error || 'Failed to update organization');
    } finally {
      setIsEditing(false);
    }
  };

  const openDeleteModal = () => {
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteError(null);
  };

  const handleDeleteOrganization = async () => {
    if (!organization) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const token = await getToken();
      if (!token) {
        setDeleteError('Authentication required');
        return;
      }

      await organizationsApi.delete(organization.id, token);
      onOrganizationDeleted();
      closeDeleteModal();
    } catch (err: any) {
      console.error('Failed to delete organization:', err);
      setDeleteError(err.response?.data?.error || 'Failed to delete organization');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!organization) {
    return (
      <TacticalCard variant="secondary" padding="lg">
        <div className="text-center text-tactical-text-muted">
          <p className="font-mono text-sm uppercase tracking-wider">
            Select an organization to view settings
          </p>
        </div>
      </TacticalCard>
    );
  }

  return (
    <>
      <TacticalCard title="Organization Settings" padding="lg">
        <div className="space-y-6">
          {/* Organization Info */}
          <div>
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                  Organization Name
                </h4>
                <p className="text-tactical-text-secondary">{organization.name}</p>
              </div>
              {currentUserRole === 'admin' && (
                <div className="flex gap-2">
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={openEditModal}
                  >
                    Edit
                  </TacticalButton>
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={openDeleteModal}
                  >
                    Delete
                  </TacticalButton>
                </div>
              )}
            </div>
          </div>

          {/* Members Section */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider">
                Members ({members.length})
              </h4>
              <TacticalButton
                variant="primary"
                size="sm"
                onClick={() => setIsAddMemberModalOpen(true)}
              >
                + Add Member
              </TacticalButton>
            </div>

            {error && (
              <div className="mb-4 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
                <div className="flex items-start gap-3">
                  <TacticalBadge variant="danger">ERROR</TacticalBadge>
                  <span className="text-sm text-tactical-accent-red">{error}</span>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8">
                <span className="text-sm text-tactical-text-muted tactical-loading-dots">
                  LOADING MEMBERS<span>.</span><span>.</span><span>.</span>
                </span>
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
                <p className="text-sm text-tactical-text-dim">No members</p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="border border-tactical-border-medium bg-tactical-bg-secondary p-3 flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-tactical-text-primary">
                          {member.email}
                        </span>
                        <TacticalBadge variant="success">
                          {member.role}
                        </TacticalBadge>
                      </div>
                      {member.name && (
                        <p className="text-xs text-tactical-text-muted mt-1">
                          {member.name}
                        </p>
                      )}
                      <p className="text-xs text-tactical-text-dim mt-1">
                        Joined {new Date(member.joined_at).toLocaleDateString()}
                      </p>
                    </div>
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      Remove
                    </TacticalButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </TacticalCard>

      {/* Add Member Modal */}
      <TacticalModal
        title="Add Member"
        isOpen={isAddMemberModalOpen}
        onClose={closeAddMemberModal}
        size="md"
      >
        <form onSubmit={handleAddMember} className="space-y-4">
          {addError && (
            <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{addError}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="memberEmail"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Member Email
            </label>
            <TacticalInput
              type="email"
              value={newMemberEmail}
              onChange={setNewMemberEmail}
              placeholder="Enter email address"
              disabled={isAdding}
            />
            <p className="text-xs text-tactical-text-dim mt-2">
              The user must already be registered with TrueCover
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={closeAddMemberModal}
              disabled={isAdding}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isAdding || !newMemberEmail.trim()}
            >
              {isAdding ? (
                <span className="tactical-loading-dots">
                  ADDING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Add Member'
              )}
            </TacticalButton>
          </div>
        </form>
      </TacticalModal>

      {/* Edit Organization Modal */}
      <TacticalModal
        title="Edit Organization"
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        size="md"
      >
        <form onSubmit={handleEditOrganization} className="space-y-4">
          {editError && (
            <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{editError}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="orgNameEdit"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Organization Name
            </label>
            <TacticalInput
              type="text"
              value={editedName}
              onChange={setEditedName}
              placeholder="Enter organization name"
              disabled={isEditing}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={closeEditModal}
              disabled={isEditing}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isEditing || !editedName.trim()}
            >
              {isEditing ? (
                <span className="tactical-loading-dots">
                  SAVING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Save Changes'
              )}
            </TacticalButton>
          </div>
        </form>
      </TacticalModal>

      {/* Delete Organization Modal */}
      <TacticalModal
        title="Delete Organization"
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        size="md"
      >
        <div className="space-y-4">
          {deleteError && (
            <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{deleteError}</span>
            </div>
          )}

          <div className="p-4 border border-tactical-accent-red bg-tactical-bg-secondary">
            <div className="flex items-start gap-3 mb-3">
              <TacticalBadge variant="danger">WARNING</TacticalBadge>
              <span className="text-sm font-mono font-bold text-tactical-accent-red uppercase tracking-wider">
                Permanent Action
              </span>
            </div>
            <p className="text-sm text-tactical-text-secondary mb-2">
              You are about to delete the organization <span className="font-bold text-tactical-text-primary">"{organization?.name}"</span>.
            </p>
            <p className="text-sm text-tactical-text-secondary mb-2">
              This will permanently delete:
            </p>
            <ul className="list-disc list-inside text-sm text-tactical-text-secondary space-y-1 ml-4">
              <li>All organization data</li>
              <li>All member associations</li>
              <li>All projects in this organization</li>
            </ul>
            <p className="text-sm text-tactical-accent-red font-bold mt-3">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={closeDeleteModal}
              disabled={isDeleting}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="button"
              variant="primary"
              onClick={handleDeleteOrganization}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <span className="tactical-loading-dots">
                  DELETING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Delete Organization'
              )}
            </TacticalButton>
          </div>
        </div>
      </TacticalModal>
    </>
  );
};

export default OrganizationSettings;
