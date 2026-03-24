import { useState } from 'react';
import { Mail, AtSign, Edit2, Save, X } from 'lucide-react';
import { useProfileByUsername, useUpdateProfile } from '../api/client';
import type { UpdateUserProfileRequest } from '../types';

// Default username for single-user app (profile auto-discovered by username)
const DEFAULT_USERNAME = 'testuser';

export function Profile() {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<UpdateUserProfileRequest>({});

  const { data: profile, isLoading, error } = useProfileByUsername(DEFAULT_USERNAME);
  const updateProfileMutation = useUpdateProfile();

  const handleEdit = () => {
    if (profile) {
      setFormData({
        username: profile.username,
        email: profile.email,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        dietary_preferences: [...profile.dietary_preferences],
      });
      setIsEditing(true);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData({});
  };

  const handleSave = async () => {
    if (!profile) return;
    try {
      await updateProfileMutation.mutateAsync({
        id: profile.id,
        profile: formData,
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
    }
  };

  const handleAddDietaryPreference = (pref: string) => {
    if (!formData.dietary_preferences?.includes(pref)) {
      setFormData({
        ...formData,
        dietary_preferences: [...(formData.dietary_preferences || []), pref],
      });
    }
  };

  const handleRemoveDietaryPreference = (pref: string) => {
    setFormData({
      ...formData,
      dietary_preferences: formData.dietary_preferences?.filter(p => p !== pref) || [],
    });
  };

  const commonDietaryPrefs = [
    'Vegetarian',
    'Vegan',
    'Gluten-Free',
    'Dairy-Free',
    'Nut-Free',
    'Pescatarian',
    'Keto',
    'Paleo',
  ];

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 lg:p-8">
        <div className="pt-4 flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pastel-pink mx-auto mb-4"></div>
            <p className="text-soft-charcoal/60">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-4 space-y-4 lg:p-8">
        <div className="pt-4">
          <div className="bg-pastel-coral/10 border border-pastel-coral/20 rounded-2xl p-6 text-center">
            <p className="text-soft-charcoal mb-4">
              {error ? 'Failed to load profile' : 'Profile not found'}
            </p>
            <p className="text-sm text-soft-charcoal/60">
              This is a demo profile feature. In production, you would be logged in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-8 lg:p-8">
      {/* Header */}
      <div className="pt-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-soft-charcoal flex items-center gap-2">
            My Profile 👤
          </h1>
          <p className="text-soft-charcoal/60 text-sm mt-1">
            Manage your account settings
          </p>
        </div>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="w-12 h-12 rounded-full bg-pastel-pink text-white flex items-center justify-center shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
          >
            <Edit2 size={20} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Profile Card + Account Stats — side by side on desktop */}
      <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6 space-y-4 lg:space-y-0">
      {/* Profile Card */}
      <div className="bg-white rounded-3xl shadow-soft p-6 space-y-6">
        {/* Avatar Section */}
        <div className="flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-pastel-lavender/30 flex items-center justify-center text-4xl mb-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                className="w-24 h-24 rounded-full object-cover"
              />
            ) : (
              '👤'
            )}
          </div>
          <h2 className="text-xl font-bold text-soft-charcoal">
            {isEditing ? (
              <input
                type="text"
                value={formData.display_name || ''}
                onChange={(e) =>
                  setFormData({ ...formData, display_name: e.target.value })
                }
                placeholder="Display name"
                className="text-center px-4 py-2 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20"
              />
            ) : (
              profile.display_name || profile.username
            )}
          </h2>
          <p className="text-sm text-soft-charcoal/60">
            @{profile.username}
          </p>
        </div>

        {/* Profile Info */}
        <div className="space-y-4">
          {/* Username */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-pastel-mint/30 flex items-center justify-center flex-shrink-0">
              <AtSign size={18} className="text-pastel-mint" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-soft-charcoal/60 block mb-1">
                Username
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.username || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, username: e.target.value })
                  }
                  className="w-full px-4 py-2 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20"
                />
              ) : (
                <p className="text-soft-charcoal font-medium">
                  {profile.username}
                </p>
              )}
            </div>
          </div>

          {/* Email */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-pastel-peach/30 flex items-center justify-center flex-shrink-0">
              <Mail size={18} className="text-pastel-peach" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-soft-charcoal/60 block mb-1">
                Email
              </label>
              {isEditing ? (
                <input
                  type="email"
                  value={formData.email || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full px-4 py-2 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20"
                />
              ) : (
                <p className="text-soft-charcoal font-medium">
                  {profile.email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Dietary Preferences */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🥗</span>
            <h3 className="text-sm font-semibold text-soft-charcoal">
              Dietary Preferences
            </h3>
          </div>

          {/* Selected Preferences */}
          <div className="flex flex-wrap gap-2">
            {(isEditing ? formData.dietary_preferences : profile.dietary_preferences)?.length === 0 ? (
              <p className="text-sm text-soft-charcoal/60 italic">
                No dietary preferences set
              </p>
            ) : (
              (isEditing ? formData.dietary_preferences : profile.dietary_preferences)?.map((pref) => (
                <span
                  key={pref}
                  className="px-3 py-1.5 rounded-full bg-pastel-mint/20 text-soft-charcoal text-sm font-medium flex items-center gap-2"
                >
                  {pref}
                  {isEditing && (
                    <button
                      onClick={() => handleRemoveDietaryPreference(pref)}
                      className="hover:text-pastel-coral transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </span>
              ))
            )}
          </div>

          {/* Add Preferences (Edit Mode) */}
          {isEditing && (
            <div className="pt-2 space-y-2">
              <p className="text-xs text-soft-charcoal/60">Add preferences:</p>
              <div className="flex flex-wrap gap-2">
                {commonDietaryPrefs
                  .filter(pref => !formData.dietary_preferences?.includes(pref))
                  .map((pref) => (
                    <button
                      key={pref}
                      onClick={() => handleAddDietaryPreference(pref)}
                      className="px-3 py-1.5 rounded-full border border-pastel-pink/30 text-soft-charcoal/60 text-sm hover:bg-pastel-pink/10 hover:border-pastel-pink transition-all"
                    >
                      + {pref}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Edit Mode Actions */}
        {isEditing && (
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSave}
              disabled={updateProfileMutation.isPending}
              className="flex-1 py-3 rounded-full bg-pastel-pink text-white font-semibold shadow-soft hover:shadow-soft-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={handleCancel}
              className="px-6 py-3 rounded-full border-2 border-soft-charcoal/20 text-soft-charcoal font-semibold hover:bg-soft-charcoal/5 transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Error Message */}
        {updateProfileMutation.isError && (
          <div className="bg-pastel-coral/10 border border-pastel-coral/20 rounded-xl p-3">
            <p className="text-sm text-pastel-coral">
              Failed to update profile. Please try again.
            </p>
          </div>
        )}
      </div>

      {/* Account Stats */}
      <div className="bg-white rounded-3xl shadow-soft p-6">
        <h3 className="text-sm font-semibold text-soft-charcoal mb-4 flex items-center gap-2">
          <span>📊</span> Account Info
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-soft-charcoal/60">Member since</span>
            <span className="font-medium text-soft-charcoal">
              {new Date(profile.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-soft-charcoal/60">Last updated</span>
            <span className="font-medium text-soft-charcoal">
              {new Date(profile.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
      </div>{/* end grid */}
    </div>
  );
}
