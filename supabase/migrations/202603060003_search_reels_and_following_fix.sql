-- Phase 4 patch: include own posts in following feed and add reels to global search

create or replace function public.get_ranked_feed(
  p_mode text default 'for_you',
  p_page integer default 0,
  p_size integer default 10,
  p_content_type text default 'all'
)
returns table (
  id uuid,
  author_id uuid,
  content text,
  media_url text,
  media_type text,
  shared_target_type text,
  shared_target_id uuid,
  created_at timestamptz,
  reactions_count integer,
  comments_count integer,
  shares_count integer,
  saved_count integer,
  rank_score numeric,
  profile jsonb
)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      greatest(coalesce(p_page, 0), 0) as page_num,
      greatest(1, least(coalesce(p_size, 10), 100)) as page_size,
      lower(trim(coalesce(p_mode, 'for_you'))) as mode_value,
      lower(trim(coalesce(p_content_type, 'all'))) as content_type_value,
      auth.uid() as viewer_id
  ),
  base as (
    select
      p.id,
      p.author_id,
      p.content,
      p.media_url,
      p.media_type,
      p.shared_target_type,
      p.shared_target_id,
      p.created_at,
      coalesce(pr.reactions_count, 0) as reactions_count,
      coalesce(pc.comments_count, 0) as comments_count,
      coalesce(ps.shares_count, 0) as shares_count,
      coalesce(sp.saved_count, 0) as saved_count,
      case when f.following_id is not null then 1 else 0 end as is_following,
      p.promoted_until,
      p.promotion_credits
    from public.posts p
    cross join params prm
    left join (
      select post_id, count(*)::integer as reactions_count
      from public.post_reactions
      group by post_id
    ) pr on pr.post_id = p.id
    left join (
      select post_id, count(*)::integer as comments_count
      from public.comments
      group by post_id
    ) pc on pc.post_id = p.id
    left join (
      select post_id, count(*)::integer as shares_count
      from public.shared_posts
      group by post_id
    ) ps on ps.post_id = p.id
    left join (
      select post_id, count(*)::integer as saved_count
      from public.saved_posts
      group by post_id
    ) sp on sp.post_id = p.id
    left join public.follows f
      on f.follower_id = prm.viewer_id
     and f.following_id = p.author_id
    where
      (
        prm.mode_value <> 'following'
        or (
          prm.viewer_id is not null
          and (f.following_id is not null or p.author_id = prm.viewer_id)
        )
      )
      and (
        prm.content_type_value = 'all'
        or (prm.content_type_value = 'text' and p.media_type is null)
        or (prm.content_type_value = 'image' and p.media_type = 'image')
        or (prm.content_type_value = 'video' and p.media_type = 'video')
      )
  ),
  scored as (
    select
      b.*,
      (
        (200.0 / (1 + greatest(extract(epoch from (now() - b.created_at)) / 3600.0, 0))) +
        (b.reactions_count * 2.0) +
        (b.comments_count * 3.0) +
        (b.shares_count * 4.0) +
        (b.saved_count * 2.0) +
        (case when b.is_following = 1 then 40.0 else 0.0 end) +
        (case when b.promoted_until is not null and b.promoted_until > now() then least(coalesce(b.promotion_credits, 0), 50) * 1.2 else 0.0 end)
      ) as rank_score
    from base b
  ),
  ranked as (
    select
      s.id,
      s.author_id,
      s.content,
      s.media_url,
      s.media_type,
      s.shared_target_type,
      s.shared_target_id,
      s.created_at,
      s.reactions_count,
      s.comments_count,
      s.shares_count,
      s.saved_count,
      s.rank_score,
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'is_premium', coalesce(p.is_premium, false),
        'is_verified', coalesce(p.is_verified, false)
      ) as profile,
      row_number() over (order by s.rank_score desc, s.created_at desc) as row_num
    from scored s
    join public.profiles p on p.id = s.author_id
  )
  select
    r.id,
    r.author_id,
    r.content,
    r.media_url,
    r.media_type,
    r.shared_target_type,
    r.shared_target_id,
    r.created_at,
    r.reactions_count,
    r.comments_count,
    r.shares_count,
    r.saved_count,
    r.rank_score,
    r.profile
  from ranked r
  cross join params prm
  where r.row_num > (prm.page_num * prm.page_size)
    and r.row_num <= ((prm.page_num + 1) * prm.page_size)
  order by r.row_num;
$$;


create or replace function public.global_search(
  p_query text,
  p_scope text default 'all',
  p_limit integer default 40
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank_score numeric,
  payload jsonb
)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      lower(trim(coalesce(p_query, ''))) as q,
      lower(trim(coalesce(p_scope, 'all'))) as scope_value,
      greatest(1, least(coalesce(p_limit, 40), 120)) as max_items,
      auth.uid() as viewer_id
  ),
  profile_results as (
    select
      'profile'::text as result_type,
      p.id as result_id,
      p.full_name as title,
      '@' || p.username as subtitle,
      p.created_at,
      (
        case when lower(p.username) = prm.q then 180 else 0 end +
        case when lower(p.username) like prm.q || '%' then 120 else 0 end +
        case when lower(p.full_name) like prm.q || '%' then 80 else 0 end +
        case when lower(p.username) like '%' || prm.q || '%' then 40 else 0 end +
        case when lower(p.full_name) like '%' || prm.q || '%' then 30 else 0 end
      )::numeric as rank_score,
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'is_premium', coalesce(p.is_premium, false),
        'is_verified', coalesce(p.is_verified, false)
      ) as payload
    from public.profiles p
    cross join params prm
    left join public.account_settings aset on aset.user_id = p.id
    where
      prm.q <> ''
      and (
        lower(p.username) like '%' || prm.q || '%'
        or lower(p.full_name) like '%' || prm.q || '%'
      )
      and (
        p.id = prm.viewer_id
        or coalesce((aset.discoverability ->> 'searchable_profile')::boolean, true)
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = p.id)
             or (pb.blocker_id = p.id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  post_results as (
    select
      'post'::text as result_type,
      p.id as result_id,
      left(p.content, 120) as title,
      coalesce('@' || pr.username, 'Publicacion') as subtitle,
      p.created_at,
      (
        case when lower(p.content) like prm.q || '%' then 80 else 0 end +
        case when lower(p.content) like '%' || prm.q || '%' then 40 else 0 end +
        (coalesce(prs.reactions_count, 0) * 2) +
        (coalesce(pcs.comments_count, 0) * 3) +
        (coalesce(pss.shares_count, 0) * 4) +
        (case when f.following_id is not null then 24 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', p.id,
        'author_id', p.author_id,
        'content', p.content,
        'media_url', p.media_url,
        'media_type', p.media_type,
        'shared_target_type', p.shared_target_type,
        'shared_target_id', p.shared_target_id,
        'created_at', p.created_at,
        'reactions_count', coalesce(prs.reactions_count, 0),
        'comments_count', coalesce(pcs.comments_count, 0),
        'shares_count', coalesce(pss.shares_count, 0),
        'saved_count', coalesce(sps.saved_count, 0),
        'profile', jsonb_build_object(
          'id', pr.id,
          'username', pr.username,
          'full_name', pr.full_name,
          'avatar_url', pr.avatar_url,
          'is_premium', coalesce(pr.is_premium, false),
          'is_verified', coalesce(pr.is_verified, false)
        )
      ) as payload
    from public.posts p
    cross join params prm
    join public.profiles pr on pr.id = p.author_id
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = p.author_id
    left join (
      select post_id, count(*)::integer as reactions_count
      from public.post_reactions
      group by post_id
    ) prs on prs.post_id = p.id
    left join (
      select post_id, count(*)::integer as comments_count
      from public.comments
      group by post_id
    ) pcs on pcs.post_id = p.id
    left join (
      select post_id, count(*)::integer as shares_count
      from public.shared_posts
      group by post_id
    ) pss on pss.post_id = p.id
    left join (
      select post_id, count(*)::integer as saved_count
      from public.saved_posts
      group by post_id
    ) sps on sps.post_id = p.id
    where
      prm.q <> ''
      and lower(p.content) like '%' || prm.q || '%'
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = p.author_id)
             or (pb.blocker_id = p.author_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  stream_results as (
    select
      'stream'::text as result_type,
      s.id as result_id,
      s.title,
      coalesce(s.category, 'stream') as subtitle,
      s.created_at,
      (
        case when lower(s.title) like prm.q || '%' then 100 else 0 end +
        case when lower(s.title) like '%' || prm.q || '%' then 50 else 0 end +
        least(coalesce(s.viewer_count, 0), 100) +
        (case when f.following_id is not null then 20 else 0 end) +
        (case when s.is_live then 30 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', s.id,
        'streamer_id', s.streamer_id,
        'title', s.title,
        'category', s.category,
        'is_live', s.is_live,
        'viewer_count', s.viewer_count,
        'stream_key_hint', s.stream_key_hint,
        'created_at', s.created_at
      ) as payload
    from public.streams s
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = s.streamer_id
    where
      prm.q <> ''
      and (
        lower(s.title) like '%' || prm.q || '%'
        or lower(coalesce(s.category, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = s.streamer_id)
             or (pb.blocker_id = s.streamer_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  vod_results as (
    select
      'stream_vod'::text as result_type,
      v.id as result_id,
      v.title,
      coalesce(v.description, 'Video') as subtitle,
      coalesce(v.published_at, v.created_at) as created_at,
      (
        case when lower(v.title) like prm.q || '%' then 100 else 0 end +
        case when lower(v.title) like '%' || prm.q || '%' then 50 else 0 end +
        case when lower(coalesce(v.description, '')) like '%' || prm.q || '%' then 25 else 0 end +
        least(coalesce(v.views_count, 0), 200) * 0.5 +
        (case when f.following_id is not null then 20 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', v.id,
        'stream_id', v.stream_id,
        'owner_id', v.owner_id,
        'title', v.title,
        'description', v.description,
        'vod_url', v.vod_url,
        'thumbnail_url', v.thumbnail_url,
        'duration_seconds', v.duration_seconds,
        'views_count', v.views_count,
        'visibility', v.visibility,
        'status', v.status,
        'published_at', v.published_at,
        'created_at', v.created_at,
        'updated_at', v.updated_at
      ) as payload
    from public.stream_vods v
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = v.owner_id
    where
      prm.q <> ''
      and v.status = 'ready'
      and v.visibility in ('public', 'unlisted')
      and (
        lower(v.title) like '%' || prm.q || '%'
        or lower(coalesce(v.description, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = v.owner_id)
             or (pb.blocker_id = v.owner_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  reel_results as (
    select
      'reel'::text as result_type,
      r.id as result_id,
      coalesce(nullif(r.title, ''), 'Reel') as title,
      coalesce(r.description, 'Reel') as subtitle,
      r.created_at,
      (
        case when lower(coalesce(r.title, '')) like prm.q || '%' then 95 else 0 end +
        case when lower(coalesce(r.title, '')) like '%' || prm.q || '%' then 45 else 0 end +
        case when lower(coalesce(r.description, '')) like '%' || prm.q || '%' then 30 else 0 end +
        least(coalesce(r.views_count, 0), 250) * 0.5 +
        least(coalesce(r.likes_count, 0), 200) * 0.35 +
        (case when f.following_id is not null then 20 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', r.id,
        'author_id', r.author_id,
        'title', r.title,
        'description', r.description,
        'video_url', r.video_url,
        'thumbnail_url', r.thumbnail_url,
        'likes_count', r.likes_count,
        'comments_count', r.comments_count,
        'shares_count', r.shares_count,
        'saves_count', r.saves_count,
        'views_count', r.views_count,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) as payload
    from public.reels r
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = r.author_id
    where
      prm.q <> ''
      and (
        lower(coalesce(r.title, '')) like '%' || prm.q || '%'
        or lower(coalesce(r.description, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = r.author_id)
             or (pb.blocker_id = r.author_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  combined as (
    select * from profile_results
    union all
    select * from post_results
    union all
    select * from stream_results
    union all
    select * from vod_results
    union all
    select * from reel_results
  )
  select
    c.result_type,
    c.result_id,
    c.title,
    c.subtitle,
    c.created_at,
    c.rank_score,
    c.payload
  from combined c
  cross join params prm
  where
    prm.scope_value = 'all'
    or (prm.scope_value = 'profiles' and c.result_type = 'profile')
    or (prm.scope_value = 'posts' and c.result_type = 'post')
    or (prm.scope_value = 'reels' and c.result_type = 'reel')
    or (prm.scope_value = 'streams' and c.result_type = 'stream')
    or (prm.scope_value = 'vods' and c.result_type = 'stream_vod')
    or (prm.scope_value = 'videos' and c.result_type in ('post', 'stream_vod', 'reel'))
  order by c.rank_score desc, c.created_at desc
  limit (select max_items from params);
$$;

grant execute on function public.get_ranked_feed(text, integer, integer, text) to authenticated, service_role, anon;
grant execute on function public.global_search(text, text, integer) to authenticated, service_role, anon;
