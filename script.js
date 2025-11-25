let sentimentChart = null;
let engagementChart = null;
let keywordChart = null;
let keywordSentimentChart = null;

let lastAnalysisPayload = null;

async function analyzeVideo() {
    const url = document.getElementById("urlInput").value;
    if (!url) return alert("Please enter a YouTube URL!");

    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loading").classList.remove("hidden");
    document.getElementById("results").classList.add("hidden");
    document.getElementById("toxicAlertBox").classList.add("hidden");
    document.getElementById("analyzeBtn").disabled = true;

    try {
        const response = await fetch("http://localhost:5000/analyze", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({url})
        });

        const data = await response.json();

        if (data.error) {
            alert(data.error);
            document.getElementById("loading").classList.add("hidden");
            document.getElementById("landingPage").classList.remove("hidden");
            document.getElementById("analyzeBtn").disabled = false;
            return;
        }

        lastAnalysisPayload = data; 
        renderResults(data);
    } catch (e) {
        console.error(e);
        alert("System Malfunction: Ensure Python backend is online.");
        document.getElementById("loading").classList.add("hidden");
        document.getElementById("landingPage").classList.remove("hidden");
    } finally {
        document.getElementById("analyzeBtn").disabled = false;
    }
}

function renderResults(data) {
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("results").classList.remove("hidden");

    const info = data.video_info;

    document.getElementById("videoThumbnail").src = info.thumbnail;
    document.getElementById("videoTitle").innerText = info.title;
    document.getElementById("videoChannel").innerText = info.channel;
    document.getElementById("videoViews").innerText = Number(info.views).toLocaleString();
    document.getElementById("videoLikes").innerText = Number(info.likes).toLocaleString();
    document.getElementById("videoComments").innerText = Number(info.comments).toLocaleString();
    document.getElementById("engagementScore").innerText = info.engagement_rate + "%";


    document.getElementById("videoTags").innerHTML = (info.tags || []).map(t => `<span class="bg-white/5 px-2 py-1 rounded border border-white/10 hover:border-indigo-500 transition">#${t}</span>`).join("");
    document.getElementById("genHashtags").innerHTML = (data.hashtags || []).map(h => `<span class="px-3 py-1 bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-full text-sm font-semibold hover:bg-indigo-600 hover:text-white transition cursor-pointer select-all">${h}</span>`).join("");

    document.getElementById("topicCloud").innerHTML = (data.analysis.common_topics || []).map(([w,c]) => `
        <div class="px-4 py-2 bg-white/5 rounded-lg border border-white/10 flex items-center gap-3 hover:bg-white/10 transition">
            <span class="text-gray-200">${w}</span>
            <span class="bg-indigo-500 text-white text-xs px-2 py-0.5 rounded-full">${c}</span>
        </div>
    `).join("");

    const trolls = data.analysis.toxic_users;
    if (trolls && trolls.length > 0) {
        document.getElementById("toxicAlertBox").classList.remove("hidden");
        document.getElementById("toxicUsersList").innerHTML = trolls.map(user => `
            <div class="bg-black/20 p-4 rounded-xl border border-red-500/30 flex gap-4">
                <img src="${user.avatar}" class="w-12 h-12 rounded-full border-2 border-red-500">
                <div>
                    <p class="font-bold text-red-200">${user.author}</p>
                    <p class="text-xs text-red-400 mb-2">Flagged: ${user.neg_count} / ${user.count} comments</p>
                    <div class="text-xs text-gray-400 italic border-l-2 border-red-500/50 pl-2">"${user.examples[0] || ''}"</div>
                </div>
            </div>
        `).join("");
    } else {
        document.getElementById("toxicUsersList").innerHTML = `<div class="text-sm text-gray-400">No repeat toxic users detected.</div>`;
    }


    document.getElementById("suggestionsBox").innerHTML = (data.suggestions || []).map(s => {
        let border = "border-indigo-400/30";
        if (s.includes("⚠️")) border = "border-yellow-400/50";
        if (s.includes("🛑")) border = "border-red-400/50";
        if (s.includes("💡")) border = "border-green-400/50";

        return `<div class="bg-black/20 p-3 rounded-lg border ${border} flex items-start gap-3">
            <span class="mt-0.5">🔹</span>
            <p class="text-sm text-gray-200 leading-relaxed">${s.replace(/[*]/g, '')}</p>
        </div>`;
    }).join("");

    document.getElementById("posComments").innerHTML = (data.analysis.top_positive_comments || []).map(c => `<li class="p-4 bg-green-900/10 border border-green-500/20 rounded-xl">${c}</li>`).join("");
    document.getElementById("negComments").innerHTML = (data.analysis.top_negative_comments || []).map(c => `<li class="p-4 bg-red-900/10 border border-red-500/20 rounded-xl">${c}</li>`).join("");

    renderCharts(data);

    document.getElementById("downloadJsonBtn").onclick = () => downloadJSONReport();
    document.getElementById("downloadCsvBtn").onclick = () => downloadCommentsCSV();
}

function renderCharts(data) {
    const ctxSent = document.getElementById('sentimentChart').getContext('2d');
    if (sentimentChart) sentimentChart.destroy();

    sentimentChart = new Chart(ctxSent, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Neutral', 'Negative'],
            datasets: [{
                data: [data.analysis.positive, data.analysis.neutral, data.analysis.negative],
                backgroundColor: ['rgba(34,197,94,0.85)', 'rgba(148,163,184,0.6)', 'rgba(239,68,68,0.85)'],
                borderColor: '#0b0a1a', borderWidth: 4, hoverOffset: 12
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { family: 'Space Grotesk' } } } }
        }
    });

    const ctxEng = document.getElementById('engagementChart').getContext('2d');
    if (engagementChart) engagementChart.destroy();

    let gradientPink = ctxEng.createLinearGradient(0, 0, 0, 400);
    gradientPink.addColorStop(0, '#ec4899'); gradientPink.addColorStop(1, 'rgba(236,72,153,0.12)');

    let gradientPurple = ctxEng.createLinearGradient(0, 0, 0, 400);
    gradientPurple.addColorStop(0, '#8b5cf6'); gradientPurple.addColorStop(1, 'rgba(139,92,246,0.12)');

    engagementChart = new Chart(ctxEng, {
        type: 'bar',
        data: {
            labels: ['Likes', 'Comments'],
            datasets: [{
                label: 'Count',
                data: [data.video_info.likes, data.video_info.comments],
                backgroundColor: [gradientPink, gradientPurple],
                borderColor: ['#ec4899', '#8b5cf6'],
                borderWidth: 2, borderRadius: 20, barThickness: 60
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.08)', borderDash: [5,5] }, ticks: { color: '#94a3b8', font: { family: 'Space Grotesk' } } },
                x: { grid: { display: false }, ticks: { color: '#e2e8f0', font: { size: 14, family: 'Space Grotesk', weight: 'bold' } } }
            }
        }
    });

    const ctxKey = document.getElementById("keywordChart").getContext("2d");
    if (keywordChart) keywordChart.destroy();

    const keywordFreq = (data.keyword_freq || []).slice(0, 12); 
    const labels = keywordFreq.map(k => k.keyword);
    const values = keywordFreq.map(k => k.freq);

    keywordChart = new Chart(ctxKey, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: "Frequency",
                data: values,
                backgroundColor: 'rgba(99,102,241,0.72)',
                borderColor: '#6366f1',
                borderWidth: 2,
                borderRadius: 10,
                barThickness: 36
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                x: { ticks: { color: '#e2e8f0', font: { family: 'Space Grotesk', weight: 'bold' } }, grid: { display: false } }
            }
        }
    });

    const ctxKs = document.getElementById("keywordSentimentChart").getContext("2d");
    if (keywordSentimentChart) keywordSentimentChart.destroy();

    const ks = (data.keyword_sentiment || []).slice(0, 12);
    const kLabels = ks.map(x => x.keyword);
    const posArr = ks.map(x => x.pos);
    const neuArr = ks.map(x => x.neu);
    const negArr = ks.map(x => x.neg);

    keywordSentimentChart = new Chart(ctxKs, {
        type: 'bar',
        data: {
            labels: kLabels,
            datasets: [
                { label: "Positive", data: posArr, stack: 'Stack 0', backgroundColor: 'rgba(34,197,94,0.85)' },
                { label: "Neutral", data: neuArr, stack: 'Stack 0', backgroundColor: 'rgba(148,163,184,0.6)' },
                { label: "Negative", data: negArr, stack: 'Stack 0', backgroundColor: 'rgba(239,68,68,0.85)' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0' } } },
            scales: {
                x: { stacked: true, ticks: { color: '#e2e8f0' } },
                y: { stacked: true, beginAtZero: true, ticks: { color: '#cbd5e1' } }
            }
        }
    });
}

function downloadJSONReport() {
    if (!lastAnalysisPayload) return alert("No report available.");
    const blob = new Blob([JSON.stringify(lastAnalysisPayload, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (lastAnalysisPayload.video_info?.title || "report").replace(/[^\w\s-]/g, '').slice(0,40);
    a.download = `${safeTitle}_ytinsight.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function downloadCommentsCSV() {
    if (!lastAnalysisPayload) return alert("No data.");
    const rows = [["author","text","sentiment_compound"]];
    const comments = lastAnalysisPayload.comments || [];
    comments.forEach(c => rows.push([escapeCsv(c.author), escapeCsv(c.text), c.sentiment.toFixed ? c.sentiment.toFixed(3) : c.sentiment]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(lastAnalysisPayload.video_info?.title || 'comments').replace(/[^\w\s-]/g,'').slice(0,40)}_comments.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function escapeCsv(s) {
    if (s == null) return '""';
    return `"${String(s).replace(/"/g,'""')}"`;
}
