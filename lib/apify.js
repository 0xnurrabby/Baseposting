function apifyUrl({ datasetId, token, limit = 200 }) {
  const base = "https://api.apify.com";
  const qs = new URLSearchParams({
    token,
    clean: "true",
    format: "json",
    limit: String(limit),
    desc: "1"
  });
  return `${base}/v2/datasets/${encodeURIComponent(datasetId)}/items?${qs.toString()}`;
}

function pickTweetId(it) {
  return it.tweet_id || it.tweetId || it.id || it.statusId || it.tweet?.id || it.tweet?.tweet_id || null;
}

function pickHandle(it) {
  return it.handle || it.username || it.user?.username || it.author?.username || it.userHandle || it.screen_name || "unknown";
}

function pickText(it) {
  return it.text || it.fullText || it.content || it.tweet?.text || it.tweet?.fullText || it.tweetText || "";
}

function pickUrl(it) {
  return it.url || it.tweetUrl || it.tweet?.url || it.link || null;
}

function pickTimestamp(it) {
  const v =
    it.timestamp ||
    it.created_at ||
    it.createdAt ||
    it.tweet?.createdAt ||
    it.tweet?.created_at ||
    it.time ||
    null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickCounts(it) {
  return {
    like: Number(it.like_count ?? it.likes ?? it.likeCount ?? it.favorites ?? it.tweet?.likeCount ?? 0) || 0,
    reply: Number(it.reply_count ?? it.replies ?? it.replyCount ?? it.tweet?.replyCount ?? 0) || 0,
    retweet: Number(it.retweet_count ?? it.retweets ?? it.retweetCount ?? it.tweet?.retweetCount ?? 0) || 0,
    quote: Number(it.quote_count ?? it.quotes ?? it.quoteCount ?? it.tweet?.quoteCount ?? 0) || 0,
  };
}

function pickFlags(it) {
  const isReply = Boolean(it.is_reply ?? it.isReply ?? it.replyTo ?? it.inReplyToStatusId ?? false);
  const isRetweet = Boolean(it.is_retweet ?? it.isRetweet ?? it.retweeted_status ?? false);
  return { isReply, isRetweet };
}

module.exports = {
  apifyUrl,
  pickTweetId,
  pickHandle,
  pickText,
  pickUrl,
  pickTimestamp,
  pickCounts,
  pickFlags,
};
