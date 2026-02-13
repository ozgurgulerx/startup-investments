'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Bell, ListChecks, MessageSquare, Plus, ShieldCheck, Users, Vote } from 'lucide-react';

type PostType = 'question' | 'answer' | 'evidence' | 'counterpoint' | 'update';

interface CommunityTemplate {
  key: string;
  label: string;
  post_type: PostType;
  body: string;
}

interface CommunityPost {
  id: string;
  user_name: string;
  user_trust_level: number;
  post_type: PostType;
  body: string;
  is_pinned: boolean;
  created_at: string;
  vote_score: number;
  my_vote: number;
}

interface CommunityProfile {
  reputation_points: number;
  trust_level: number;
  role: string;
}

interface CommunityResponse {
  signal_id: string;
  templates: CommunityTemplate[];
  me: CommunityProfile | null;
  posts: CommunityPost[];
}

interface PollOption {
  key: string;
  label: string;
  votes: number;
  share: number;
}

interface SignalPoll {
  id: string;
  question: string;
  options: PollOption[];
  closes_at: string | null;
  status: 'open' | 'closed';
  total_votes: number;
  my_vote: string | null;
}

interface PollResponse {
  polls: SignalPoll[];
}

interface NotificationPreferences {
  digest_frequency: 'realtime' | 'daily' | 'weekly' | 'off';
  mute_low_severity: boolean;
  muted_delta_types: string[];
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string;
  enable_recommended_follows: boolean;
}

interface SharedWatchlist {
  id: string;
  name: string;
  visibility: 'private' | 'team' | 'public';
  my_role: 'owner' | 'editor' | 'viewer' | null;
  item_count: number;
  invite_code: string;
}

interface SharedWatchlistsResponse {
  watchlists: SharedWatchlist[];
}

function trustLabel(level: number): string {
  if (level >= 3) return 'Steward';
  if (level >= 2) return 'Moderator';
  if (level >= 1) return 'Contributor';
  return 'Reader';
}

function postTypeLabel(postType: PostType): string {
  const labels: Record<PostType, string> = {
    question: 'Question',
    answer: 'Answer',
    evidence: 'Evidence',
    counterpoint: 'Counterpoint',
    update: 'Update',
  };
  return labels[postType];
}

export function CommunityTab({ signalId }: { signalId: string }) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user?.id;

  const [community, setCommunity] = useState<CommunityResponse | null>(null);
  const [polls, setPolls] = useState<SignalPoll[]>([]);
  const [watchlists, setWatchlists] = useState<SharedWatchlist[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [postType, setPostType] = useState<PostType>('answer');
  const [postBody, setPostBody] = useState('');
  const [posting, setPosting] = useState(false);

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);

  const [createWatchlistName, setCreateWatchlistName] = useState('');
  const [createWatchlistVisibility, setCreateWatchlistVisibility] = useState<'private' | 'team' | 'public'>('private');
  const [joinCode, setJoinCode] = useState('');
  const [selectedWatchlistId, setSelectedWatchlistId] = useState('');
  const [watchlistSlug, setWatchlistSlug] = useState('');
  const [watchlistNotes, setWatchlistNotes] = useState('');

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [communityRes, pollsRes, prefsRes, watchlistsRes] = await Promise.all([
        fetch(`/api/signals/${signalId}/community?limit=50`),
        fetch(`/api/signals/${signalId}/polls`),
        fetch('/api/community/preferences'),
        isAuthenticated ? fetch('/api/community/watchlists') : Promise.resolve(new Response(JSON.stringify({ watchlists: [] }))),
      ]);

      const communityData = await communityRes.json() as CommunityResponse;
      const pollsData = await pollsRes.json() as PollResponse;
      const prefsData = await prefsRes.json() as NotificationPreferences;
      const watchlistsData = await watchlistsRes.json() as SharedWatchlistsResponse;

      setCommunity(communityData);
      setPolls(Array.isArray(pollsData.polls) ? pollsData.polls : []);
      setPreferences(prefsData);
      const wl = Array.isArray(watchlistsData.watchlists) ? watchlistsData.watchlists : [];
      setWatchlists(wl);
      if (!selectedWatchlistId && wl.length > 0) {
        setSelectedWatchlistId(wl[0].id);
      }
    } catch (err) {
      console.error('Failed loading community tab:', err);
      setError('Failed to load community modules');
    } finally {
      setLoading(false);
    }
  }, [signalId, isAuthenticated, selectedWatchlistId]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  const canModerate = useMemo(() => {
    const trust = community?.me?.trust_level || 0;
    const role = community?.me?.role || session?.user?.role;
    return trust >= 2 || role === 'admin' || role === 'editor';
  }, [community, session]);

  const canCreatePoll = useMemo(() => {
    const trust = community?.me?.trust_level || 0;
    const role = community?.me?.role || session?.user?.role;
    return trust >= 1 || role === 'admin' || role === 'editor';
  }, [community, session]);

  const onApplyTemplate = useCallback((template: CommunityTemplate) => {
    setPostType(template.post_type);
    setPostBody(template.body);
  }, []);

  const onSubmitPost = useCallback(async () => {
    if (!isAuthenticated || !postBody.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/signals/${signalId}/community`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_type: postType, body: postBody }),
      });
      if (!res.ok) throw new Error('Post failed');
      setPostBody('');
      await reloadAll();
    } catch (err) {
      console.error('Failed posting to thread:', err);
      setError('Failed to post contribution');
    } finally {
      setPosting(false);
    }
  }, [isAuthenticated, postBody, signalId, postType, reloadAll]);

  const onVotePost = useCallback(async (postId: string, vote: 1 | -1) => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(`/api/signals/${signalId}/community/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, vote }),
      });
      if (!res.ok) throw new Error('Vote failed');
      await reloadAll();
    } catch (err) {
      console.error('Failed voting on post:', err);
      setError('Failed to vote on post');
    }
  }, [isAuthenticated, reloadAll, signalId]);

  const onPinPost = useCallback(async (postId: string, pinned: boolean) => {
    try {
      const res = await fetch(`/api/signals/${signalId}/community/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, pinned }),
      });
      if (!res.ok) throw new Error('Pin failed');
      await reloadAll();
    } catch (err) {
      console.error('Failed pinning post:', err);
      setError('Failed to pin post');
    }
  }, [reloadAll, signalId]);

  const onCreatePoll = useCallback(async () => {
    if (!isAuthenticated || !canCreatePoll) return;
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (pollQuestion.trim().length < 5 || options.length < 2) {
      setError('Poll needs a question and at least 2 options');
      return;
    }
    setCreatingPoll(true);
    try {
      const res = await fetch(`/api/signals/${signalId}/polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: pollQuestion, options }),
      });
      if (!res.ok) throw new Error('Create poll failed');
      setPollQuestion('');
      setPollOptions(['', '']);
      await reloadAll();
    } catch (err) {
      console.error('Failed creating poll:', err);
      setError('Failed to create poll');
    } finally {
      setCreatingPoll(false);
    }
  }, [isAuthenticated, canCreatePoll, pollQuestion, pollOptions, signalId, reloadAll]);

  const onVotePoll = useCallback(async (pollId: string, optionKey: string) => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(`/api/signals/${signalId}/polls/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_id: pollId, option_key: optionKey }),
      });
      if (!res.ok) throw new Error('Vote poll failed');
      await reloadAll();
    } catch (err) {
      console.error('Failed voting poll:', err);
      setError('Failed to vote in poll');
    }
  }, [isAuthenticated, signalId, reloadAll]);

  const onSavePreferences = useCallback(async () => {
    if (!preferences || !isAuthenticated) return;
    try {
      const res = await fetch('/api/community/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      if (!res.ok) throw new Error('Save preferences failed');
      await reloadAll();
    } catch (err) {
      console.error('Failed updating preferences:', err);
      setError('Failed to save notification preferences');
    }
  }, [preferences, isAuthenticated, reloadAll]);

  const onCreateWatchlist = useCallback(async () => {
    if (!isAuthenticated || !createWatchlistName.trim()) return;
    try {
      const res = await fetch('/api/community/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createWatchlistName.trim(),
          visibility: createWatchlistVisibility,
        }),
      });
      if (!res.ok) throw new Error('Create watchlist failed');
      setCreateWatchlistName('');
      await reloadAll();
    } catch (err) {
      console.error('Failed creating shared watchlist:', err);
      setError('Failed to create shared watchlist');
    }
  }, [isAuthenticated, createWatchlistName, createWatchlistVisibility, reloadAll]);

  const onJoinWatchlist = useCallback(async () => {
    if (!isAuthenticated || !joinCode.trim()) return;
    try {
      const res = await fetch('/api/community/watchlists/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: joinCode.trim() }),
      });
      if (!res.ok) throw new Error('Join watchlist failed');
      setJoinCode('');
      await reloadAll();
    } catch (err) {
      console.error('Failed joining watchlist:', err);
      setError('Failed to join shared watchlist');
    }
  }, [isAuthenticated, joinCode, reloadAll]);

  const onAddWatchlistItem = useCallback(async () => {
    if (!isAuthenticated || !selectedWatchlistId || !watchlistSlug.trim()) return;
    try {
      const res = await fetch(`/api/community/watchlists/${selectedWatchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_slug: watchlistSlug.trim(),
          notes: watchlistNotes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Add item failed');
      setWatchlistSlug('');
      setWatchlistNotes('');
      await reloadAll();
    } catch (err) {
      console.error('Failed adding watchlist item:', err);
      setError('Failed to add item to shared watchlist');
    }
  }, [isAuthenticated, selectedWatchlistId, watchlistSlug, watchlistNotes, reloadAll]);

  if (loading) {
    return (
      <div className="p-4 border border-border/30 rounded-lg text-sm text-muted-foreground">
        Loading community modules...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-3 py-2 rounded border border-warning/40 bg-warning/10 text-xs text-muted-foreground">
          {error}
        </div>
      )}

      <section className="p-4 border border-border/30 rounded-lg bg-card/40">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent-info" />
            <span className="text-sm font-medium text-foreground">Trust & Reputation</span>
          </div>
          {community?.me ? (
            <span className="text-xs text-muted-foreground">
              {community.me.reputation_points} pts · {trustLabel(community.me.trust_level)} (L{community.me.trust_level})
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Sign in to contribute</span>
          )}
        </div>
      </section>

      <section className="p-4 border border-border/30 rounded-lg bg-card/40">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-accent-info" />
          <span className="text-sm font-medium text-foreground">Signal Thread</span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {(community?.templates || []).map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => onApplyTemplate(template)}
              className="text-[11px] px-2 py-1 rounded border border-accent-info/25 text-accent-info hover:bg-accent-info/10"
            >
              {template.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Type</label>
            <select
              value={postType}
              onChange={(e) => setPostType(e.target.value as PostType)}
              className="text-xs bg-background border border-border/40 rounded px-2 py-1"
            >
              <option value="question">Question</option>
              <option value="answer">Answer</option>
              <option value="evidence">Evidence</option>
              <option value="counterpoint">Counterpoint</option>
              <option value="update">Update</option>
            </select>
          </div>
          <textarea
            value={postBody}
            onChange={(e) => setPostBody(e.target.value)}
            placeholder="Add your contribution..."
            className="w-full min-h-[92px] text-sm bg-background border border-border/40 rounded px-3 py-2"
          />
          <button
            type="button"
            disabled={!isAuthenticated || posting || !postBody.trim()}
            onClick={onSubmitPost}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent text-accent-foreground disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Post
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {(community?.posts || []).map((post) => (
            <div key={post.id} className="p-3 border border-border/25 rounded-md">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1.5">
                <span className="px-1.5 py-0.5 rounded bg-muted/30">{postTypeLabel(post.post_type)}</span>
                <span>{post.user_name}</span>
                <span>L{post.user_trust_level}</span>
                <span>{new Date(post.created_at).toLocaleString()}</span>
                {post.is_pinned && (
                  <span className="px-1.5 py-0.5 rounded bg-accent-info/10 text-accent-info">Pinned</span>
                )}
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{post.body}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onVotePost(post.id, 1)}
                  className="text-xs px-2 py-1 rounded border border-border/40 hover:border-accent-info/40"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => onVotePost(post.id, -1)}
                  className="text-xs px-2 py-1 rounded border border-border/40 hover:border-accent-info/40"
                >
                  -1
                </button>
                <span className="text-xs text-muted-foreground">
                  Score: {post.vote_score} {post.my_vote ? `(you: ${post.my_vote > 0 ? '+1' : '-1'})` : ''}
                </span>
                {canModerate && (
                  <button
                    type="button"
                    onClick={() => onPinPost(post.id, !post.is_pinned)}
                    className="ml-auto text-xs text-accent-info hover:underline"
                  >
                    {post.is_pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {(community?.posts || []).length === 0 && (
            <p className="text-xs text-muted-foreground">No contributions yet. Start the thread with an evidence note or question.</p>
          )}
        </div>
      </section>

      <section className="p-4 border border-border/30 rounded-lg bg-card/40">
        <div className="flex items-center gap-2 mb-3">
          <Vote className="w-4 h-4 text-accent-info" />
          <span className="text-sm font-medium text-foreground">Structured Polls</span>
        </div>

        {canCreatePoll && (
          <div className="mb-4 p-3 border border-border/25 rounded-md space-y-2">
            <input
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Poll question..."
              className="w-full text-sm bg-background border border-border/40 rounded px-3 py-2"
            />
            {pollOptions.map((option, idx) => (
              <input
                key={idx}
                value={option}
                onChange={(e) => setPollOptions((prev) => prev.map((item, i) => (i === idx ? e.target.value : item)))}
                placeholder={`Option ${idx + 1}`}
                className="w-full text-sm bg-background border border-border/40 rounded px-3 py-2"
              />
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPollOptions((prev) => [...prev, ''])}
                disabled={pollOptions.length >= 5}
                className="text-xs px-2 py-1 rounded border border-border/40"
              >
                Add option
              </button>
              <button
                type="button"
                onClick={onCreatePoll}
                disabled={creatingPoll}
                className="text-xs px-3 py-1 rounded bg-accent text-accent-foreground"
              >
                Create poll
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {polls.map((poll) => (
            <div key={poll.id} className="p-3 border border-border/25 rounded-md">
              <p className="text-sm text-foreground mb-2">{poll.question}</p>
              <div className="space-y-1.5">
                {poll.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onVotePoll(poll.id, option.key)}
                    className="w-full text-left px-2 py-1.5 rounded border border-border/35 hover:border-accent-info/40"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className={poll.my_vote === option.key ? 'text-accent-info' : 'text-foreground'}>
                        {option.label}
                      </span>
                      <span className="text-muted-foreground">
                        {option.votes} ({(option.share * 100).toFixed(0)}%)
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {polls.length === 0 && (
            <p className="text-xs text-muted-foreground">No polls yet for this signal.</p>
          )}
        </div>
      </section>

      <section className="p-4 border border-border/30 rounded-lg bg-card/40">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-accent-info" />
          <span className="text-sm font-medium text-foreground">Notification Hygiene</span>
        </div>

        {preferences && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">
              Digest frequency
              <select
                value={preferences.digest_frequency}
                onChange={(e) => setPreferences((prev) => prev ? { ...prev, digest_frequency: e.target.value as NotificationPreferences['digest_frequency'] } : prev)}
                className="mt-1 w-full bg-background border border-border/40 rounded px-2 py-1 text-sm text-foreground"
              >
                <option value="realtime">Realtime</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="off">Off</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground">
              Muted delta types (comma-separated)
              <input
                value={preferences.muted_delta_types.join(', ')}
                onChange={(e) => setPreferences((prev) => prev ? {
                  ...prev,
                  muted_delta_types: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                } : prev)}
                className="mt-1 w-full bg-background border border-border/40 rounded px-2 py-1 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Quiet hours start
              <input
                type="number"
                min={0}
                max={23}
                value={preferences.quiet_hours_start}
                onChange={(e) => setPreferences((prev) => prev ? { ...prev, quiet_hours_start: Number(e.target.value) } : prev)}
                className="mt-1 w-full bg-background border border-border/40 rounded px-2 py-1 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Quiet hours end
              <input
                type="number"
                min={0}
                max={23}
                value={preferences.quiet_hours_end}
                onChange={(e) => setPreferences((prev) => prev ? { ...prev, quiet_hours_end: Number(e.target.value) } : prev)}
                className="mt-1 w-full bg-background border border-border/40 rounded px-2 py-1 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={preferences.mute_low_severity}
                onChange={(e) => setPreferences((prev) => prev ? { ...prev, mute_low_severity: e.target.checked } : prev)}
              />
              Mute low-severity alerts ({'<='}2)
            </label>

            <button
              type="button"
              onClick={onSavePreferences}
              className="md:col-span-2 justify-self-start text-xs px-3 py-1.5 rounded bg-accent text-accent-foreground"
            >
              Save preferences
            </button>
          </div>
        )}
      </section>

      <section className="p-4 border border-border/30 rounded-lg bg-card/40">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-accent-info" />
          <span className="text-sm font-medium text-foreground">Shared Watchlists</span>
        </div>

        {!isAuthenticated ? (
          <p className="text-xs text-muted-foreground">Sign in to create or join shared watchlists.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={createWatchlistName}
                onChange={(e) => setCreateWatchlistName(e.target.value)}
                placeholder="New watchlist name"
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm"
              />
              <select
                value={createWatchlistVisibility}
                onChange={(e) => setCreateWatchlistVisibility(e.target.value as 'private' | 'team' | 'public')}
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm"
              >
                <option value="private">Private</option>
                <option value="team">Team</option>
                <option value="public">Public</option>
              </select>
              <button
                type="button"
                onClick={onCreateWatchlist}
                className="text-xs px-3 py-2 rounded bg-accent text-accent-foreground"
              >
                Create
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Invite code"
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={onJoinWatchlist}
                className="text-xs px-3 py-2 rounded border border-accent-info/30 text-accent-info"
              >
                Join
              </button>
            </div>

            <div className="space-y-2">
              {watchlists.map((wl) => (
                <div key={wl.id} className="p-2 border border-border/25 rounded-md text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground">{wl.name}</span>
                    <span>{wl.visibility} · {wl.my_role || 'viewer'} · {wl.item_count} items</span>
                  </div>
                  <div className="mt-1">Invite code: <span className="text-accent-info">{wl.invite_code}</span></div>
                </div>
              ))}
            </div>

            <div className="p-3 border border-border/25 rounded-md space-y-2">
              <div className="flex items-center gap-2">
                <ListChecks className="w-3.5 h-3.5 text-accent-info" />
                <span className="text-xs text-muted-foreground">Add startup by slug</span>
              </div>
              <select
                value={selectedWatchlistId}
                onChange={(e) => setSelectedWatchlistId(e.target.value)}
                className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm"
              >
                <option value="">Select watchlist</option>
                {watchlists
                  .filter((wl) => wl.my_role === 'owner' || wl.my_role === 'editor')
                  .map((wl) => (
                    <option key={wl.id} value={wl.id}>{wl.name}</option>
                  ))}
              </select>
              <input
                value={watchlistSlug}
                onChange={(e) => setWatchlistSlug(e.target.value)}
                placeholder="company slug (e.g. openai)"
                className="w-full bg-background border border-border/40 rounded px-3 py-2 text-sm"
              />
              <input
                value={watchlistNotes}
                onChange={(e) => setWatchlistNotes(e.target.value)}
                placeholder="note (optional)"
                className="w-full bg-background border border-border/40 rounded px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={onAddWatchlistItem}
                disabled={!selectedWatchlistId || !watchlistSlug.trim()}
                className="text-xs px-3 py-1.5 rounded bg-accent text-accent-foreground disabled:opacity-50"
              >
                Add to shared watchlist
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
