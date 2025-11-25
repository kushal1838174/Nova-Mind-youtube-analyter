import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from googleapiclient.discovery import build
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from collections import Counter, defaultdict
from string import punctuation
import yake
import math
app = Flask(__name__)
CORS(app)
YOUTUBE_API_KEY = os.getenv("Api_Key") 
if not YOUTUBE_API_KEY:
    print("Api is not properly set!!")
youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY) if YOUTUBE_API_KEY else None

sentiment_analyzer = SentimentIntensityAnalyzer()

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None

def fetch_video_info(video_id):
    if not youtube:
        raise RuntimeError("YouTube API not configured.")
    resp = youtube.videos().list(part="snippet,statistics", id=video_id).execute()
    if not resp.get("items"):
        return None
    vid = resp["items"][0]
    return vid

def fetch_comments(video_id, max_pages=2):
    
    if not youtube:
        return []
    comments = []
    request = youtube.commentThreads().list(part="snippet", videoId=video_id, maxResults=100, textFormat="plainText")
    try:
        resp = request.execute()
    except Exception:
        return comments

    pages = 0
    while resp and pages < max_pages:
        for item in resp.get("items", []):
            top = item["snippet"]["topLevelComment"]["snippet"]
            comments.append({
                "text": top.get("textDisplay", ""),
                "author": top.get("authorDisplayName", "Unknown"),
                "avatar": top.get("authorProfileImageUrl", "")
            })
        pages += 1
        if "nextPageToken" in resp and pages < max_pages:
            resp = youtube.commentThreads().list(part="snippet", videoId=video_id, maxResults=100, pageToken=resp["nextPageToken"], textFormat="plainText").execute()
        else:
            break
    return comments

def analyze_sentiment_and_users(comments_data):
    pos, neg, neu = 0, 0, 0
    positive_comments = []
    negative_comments = []
    all_words = []

    user_tracker = {}  
    stopwords = set(["the","and","is","it","to","in","this","of","a","for","on","my","that","with","video","are","but","so","be","was","i","you","me","have","just","like","your","get"])

    comments_with_scores = []

    for item in comments_data:
        text = item.get('text','')
        author = item.get('author','Unknown')
        avatar = item.get('avatar','')

        score = sentiment_analyzer.polarity_scores(text)
        compound = score['compound']
        is_negative = False

        if compound >= 0.2:
            pos += 1
            positive_comments.append(text)
        elif compound <= -0.2:
            neg += 1
            negative_comments.append(text)
            is_negative = True
        else:
            neu += 1

        if author not in user_tracker:
            user_tracker[author] = {"total":0, "neg":0, "avatar": avatar, "texts":[]}
        user_tracker[author]["total"] += 1
        if is_negative:
            user_tracker[author]["neg"] += 1
            user_tracker[author]["texts"].append(text)

        clean_text = ''.join([ch.lower() if ch not in punctuation else ' ' for ch in text])
        words = [w for w in clean_text.split() if w not in stopwords and len(w)>3]
        all_words.extend(words)

        comments_with_scores.append({"author": author, "text": text, "sentiment": compound, "tokens": words})

    toxic_users = []
    for user, stats in user_tracker.items():
        if stats["total"] > 1 and stats["neg"] >= math.ceil(stats["total"]/2):
            toxic_users.append({
                "author": user,
                "avatar": stats["avatar"],
                "count": stats["total"],
                "neg_count": stats["neg"],
                "examples": stats["texts"][:2]
            })

    common_topics = Counter(all_words).most_common(20)

    return {
        "positive": pos,
        "negative": neg,
        "neutral": neu,
        "top_positive_comments": positive_comments[:6],
        "top_negative_comments": negative_comments[:6],
        "common_topics": common_topics,
        "toxic_users": toxic_users,
        "comments_with_scores": comments_with_scores
    }

def extract_keywords(text, top=10):
    kw_extractor = yake.KeywordExtractor(top=top, stopwords=None)
    keywords = kw_extractor.extract_keywords(text)
    return [kw for kw, _ in keywords]

def build_keyword_frequency_and_sentiment(comments_with_scores, title_and_desc, top_n=12):
    
    candidates = extract_keywords(title_and_desc, top=20)
    comment_word_counter = Counter()
    for c in comments_with_scores:
        comment_word_counter.update(c['tokens'])
    if not candidates:
        candidates = [w for w,_ in comment_word_counter.most_common(20)]
    
    freq_map = Counter()
    sentiment_map = defaultdict(lambda: {"pos":0, "neu":0, "neg":0, "count":0})

    for kw in candidates:
        kw_norm = kw.lower().strip()
        for c in comments_with_scores:
            text_lower = c['text'].lower()
            if kw_norm in text_lower:
                freq_map[kw_norm] += 1
                sentiment = c['sentiment']
                sentiment_map[kw_norm]["count"] += 1
                if sentiment >= 0.2:
                    sentiment_map[kw_norm]["pos"] += 1
                elif sentiment <= -0.2:
                    sentiment_map[kw_norm]["neg"] += 1
                else:
                    sentiment_map[kw_norm]["neu"] += 1

    if not freq_map:
        for w, count in comment_word_counter.most_common(top_n):
            freq_map[w] = count

        for w in list(freq_map.keys()):
            for c in comments_with_scores:
                if w in c['tokens']:
                    sentiment = c['sentiment']
                    sentiment_map[w]["count"] += 1
                    if sentiment >= 0.2:
                        sentiment_map[w]["pos"] += 1
                    elif sentiment <= -0.2:
                        sentiment_map[w]["neg"] += 1
                    else:
                        sentiment_map[w]["neu"] += 1

  
    keyword_freq = [{"keyword": k, "freq": v} for k, v in freq_map.most_common(top_n)]
    keyword_sentiment = []
    for k, v in freq_map.most_common(top_n):
        ks = sentiment_map[k]
        keyword_sentiment.append({
            "keyword": k,
            "pos": ks["pos"],
            "neu": ks["neu"],
            "neg": ks["neg"],
            "count": ks["count"]
        })

    return keyword_freq, keyword_sentiment

def generate_hashtags(keywords):
    hashtags = []
    for kw in keywords:
        tag = "#" + "".join([c for c in kw.replace(" ", "") if c.isalnum()])
        hashtags.append(tag)
    return hashtags[:10]

def generate_smart_suggestions(title, tags, engagement_rate):
    suggestions = []
    suggestions.append(f"🎥 Title idea: {title.split('|')[0].strip()} — EXPLAINED")
    suggestions.append(f"🎯 Hook suggestion: Start with a 10s teaser answering the core question.")
    if len(title) < 30:
        suggestions.append("⚠️ SEO: Title is short — add target keywords.")
    if not tags:
        suggestions.append("🛑 Discovery: No tags found — add relevant tags.")
    if engagement_rate < 2.0:
        suggestions.append("📉 Strategy: Low engagement — ask a direct call-to-action in the first comment.")
    suggestions.append("💡 Repurpose: Create a Short from the best 15s segment.")
    return suggestions


@app.route("/analyze", methods=["POST"])
def analyze_video():
    payload = request.get_json()
    url = payload.get("url") if payload else None
    if not url:
        return jsonify({"error":"No URL provided"}), 400

    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"error":"Invalid YouTube URL"}), 400

    try:
        vid = fetch_video_info(video_id)
        if not vid:
            return jsonify({"error":"Video not found or API not configured"}), 404

        stats = vid.get("statistics", {})
        snippet = vid.get("snippet", {})

        view_count = int(stats.get("viewCount", 0))
        like_count = int(stats.get("likeCount", 0))
        comment_count = int(stats.get("commentCount", 0))
        engagement_rate = ((like_count + comment_count) / view_count * 100) if view_count > 0 else 0

        comments = fetch_comments(video_id, max_pages=2)  

        analysis = analyze_sentiment_and_users(comments)
        comments_with_scores = analysis.get("comments_with_scores", [])

        title_desc = snippet.get("title", "") + " " + snippet.get("description", "")
        keywords = extract_keywords(title_desc, top=12)
        hashtags = generate_hashtags(keywords)
        suggestions = generate_smart_suggestions(snippet.get("title", ""), snippet.get("tags", []), engagement_rate)

        keyword_freq, keyword_sentiment = build_keyword_frequency_and_sentiment(comments_with_scores, title_desc, top_n=12)

        response = {
            "video_info": {
                "title": snippet.get("title", ""),
                "channel": snippet.get("channelTitle", ""),
                "thumbnail": (snippet.get("thumbnails", {}).get("high") or snippet.get("thumbnails", {}).get("default") or {}).get("url",""),
                "views": view_count,
                "likes": like_count,
                "comments": comment_count,
                "tags": snippet.get("tags", []),
                "engagement_rate": round(engagement_rate,2)
            },
            "analysis": {
                "positive": analysis["positive"],
                "negative": analysis["negative"],
                "neutral": analysis["neutral"],
                "top_positive_comments": analysis["top_positive_comments"],
                "top_negative_comments": analysis["top_negative_comments"],
                "common_topics": analysis["common_topics"],
                "toxic_users": analysis["toxic_users"]
            },
            "keyword_freq": keyword_freq,              
            "keyword_sentiment": keyword_sentiment,     
            "keywords": keywords,
            "hashtags": hashtags,
            "suggestions": suggestions,
            "comments": [{"author": c["author"], "text": c["text"], "sentiment": c["sentiment"]} for c in comments_with_scores]
        }

        return jsonify(response)

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
