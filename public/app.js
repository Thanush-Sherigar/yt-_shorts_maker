document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const geminiKeyInput = document.getElementById('gemini-key');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const apiStatus = document.getElementById('api-status');
  const youtubeUrlInput = document.getElementById('youtube-url');
  const btnFetch = document.getElementById('btn-fetch');
  
  const advancedSettingsToggle = document.getElementById('advanced-settings-toggle');
  const advancedSettingsPanel = document.getElementById('advanced-settings');
  const targetDurationSelect = document.getElementById('target-duration');
  const aiModelSelect = document.getElementById('ai-model');
  const overlaySubsCheckbox = document.getElementById('overlay-subs');
  const addAlertsCheckbox = document.getElementById('add-alerts');
  
  const statusCard = document.getElementById('status-card');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const statusProgress = document.getElementById('status-progress');
  
  const dashboard = document.getElementById('dashboard');
  const videoThumbnail = document.getElementById('video-thumbnail');
  const videoDuration = document.getElementById('video-duration');
  const videoTitle = document.getElementById('video-title');
  const videoChannel = document.getElementById('video-channel');
  const videoDesc = document.getElementById('video-desc');
  const momentsCount = document.getElementById('moments-count');
  const momentsList = document.getElementById('moments-list');
  
  const videoModal = document.getElementById('video-modal');
  const shortsVideo = document.getElementById('shorts-video');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnDownloadShort = document.getElementById('btn-download-short');
  
  const shortDisplayTitle = document.getElementById('short-display-title');
  const shortDisplayReason = document.getElementById('short-display-reason');
  const shortTitleText = document.getElementById('short-title-text');
  const shortDescText = document.getElementById('short-desc-text');
  const shortThumbnailText = document.getElementById('short-thumbnail-text');

  // Load API Key from localStorage
  const savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) {
    geminiKeyInput.value = savedKey;
    updateKeyStatus(true);
  } else {
    updateKeyStatus(false);
  }

  // Toggle API Key visibility
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    const isPassword = geminiKeyInput.type === 'password';
    geminiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibilityBtn.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });

  // Save API Key on change
  geminiKeyInput.addEventListener('input', () => {
    const key = geminiKeyInput.value.trim();
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      updateKeyStatus(true);
    } else {
      localStorage.removeItem('gemini_api_key');
      updateKeyStatus(false);
    }
  });

  function updateKeyStatus(hasKey) {
    const getKeyLink = document.getElementById('get-key-link');
    if (hasKey) {
      apiStatus.textContent = 'Key Active';
      apiStatus.className = 'badge badge-success';
      if (getKeyLink) getKeyLink.classList.add('hidden');
    } else {
      apiStatus.textContent = 'Key Required (Demo Mode Active)';
      apiStatus.className = 'badge badge-warning';
      if (getKeyLink) getKeyLink.classList.remove('hidden');
    }
  }

  // Toggle Advanced Settings
  advancedSettingsToggle.addEventListener('click', () => {
    const isHidden = advancedSettingsPanel.classList.contains('hidden');
    if (isHidden) {
      advancedSettingsPanel.classList.remove('hidden');
      advancedSettingsToggle.querySelector('i').className = 'fa-solid fa-chevron-up';
    } else {
      advancedSettingsPanel.classList.add('hidden');
      advancedSettingsToggle.querySelector('i').className = 'fa-solid fa-chevron-down';
    }
  });

  // Global variables to store analysis context
  let currentVideoData = null;
  let currentMoments = [];

  // Main Action: Fetch and Analyze Video
  btnFetch.addEventListener('click', async () => {
    const url = youtubeUrlInput.value.trim();
    if (!url) {
      alert('Please enter a valid YouTube URL.');
      return;
    }

    // Reset UI
    dashboard.classList.add('hidden');
    statusCard.classList.remove('hidden');
    updateStatus('Extracting Video...', 'Downloading metadata and captions from YouTube. Please wait...', 15);
    btnFetch.disabled = true;

    try {
      // 1. Call Backend API to fetch metadata & transcript
      const response = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to extract video data.');
      }

      const videoData = await response.json();
      currentVideoData = videoData;
      console.log('Video Metadata and Subtitles extracted:', videoData);

      updateStatus('Analyzing Viral Potential...', 'Scanning transcript using AI to detect high-impact moments...', 50);

      // 2. Perform AI Moments Extraction (Gemini)
      const apiKey = geminiKeyInput.value.trim();
      let moments = [];
      
      if (apiKey) {
        moments = await analyzeTranscriptWithGemini(videoData, apiKey);
      } else {
        console.log('No API key provided, running in demo/fallback mode.');
        moments = generateFallbackMoments(videoData);
      }
      
      // Sort moments in descending order of virality score
      moments.sort((a, b) => b.viralityScore - a.viralityScore);
      currentMoments = moments;
      
      // 3. Display Results
      displayResults(videoData, moments);
      
    } catch (err) {
      console.error(err);
      alert('An error occurred during analysis: ' + err.message);
      statusCard.classList.add('hidden');
    } finally {
      btnFetch.disabled = false;
    }
  });

  function updateStatus(title, desc, percent) {
    statusTitle.textContent = title;
    statusDesc.textContent = desc;
    statusProgress.style.width = `${percent}%`;
  }

  // Gemini API analysis using structured outputs
  async function analyzeTranscriptWithGemini(videoData, apiKey) {
    const targetDuration = targetDurationSelect.value;
    const hasTranscript = videoData.transcript && videoData.transcript.length > 0;
    
    let transcriptText = '';
    let prompt = '';

    if (hasTranscript) {
      transcriptText = videoData.transcript.map(c => `[${c.start}] ${c.text}`).join('\n');
      prompt = `You are a YouTube Shorts growth expert.
Analyze the transcript of the video titled: "${videoData.title}"
Description: "${videoData.description}"

Find the top 3-5 most engaging, hook-heavy, or information-rich moments that are suitable for a YouTube Short (under ${targetDuration} seconds). 

IMPORTANT RULES:
1. Ensure the start and end times match the general flow of the timestamps in the transcript.
2. The segment duration must be between 15 and ${targetDuration} seconds.
3. Choose parts with strong hooks (first 3 seconds must be highly engaging).

Return a JSON array of these moments.`;
    } else {
      prompt = `You are a YouTube Shorts growth expert.
The video titled: "${videoData.title}"
Description: "${videoData.description}"
Total Duration: ${videoData.duration} seconds.

NO TRANSCRIPT OR SUBTITLES ARE AVAILABLE for this video.
Please estimate and suggest the top 3-5 potential highlight segments (under ${targetDuration} seconds) based entirely on the title, description, and overall duration.

IMPORTANT RULES:
1. Distribute the segments logically across the total duration of ${videoData.duration} seconds (e.g. Intro hook, middle climax, final summary).
2. The segment duration must be between 15 and ${targetDuration} seconds.
3. For each segment, output estimated startTime and endTime in format MM:SS or HH:MM:SS (must not exceed total duration of ${videoData.duration} seconds).
4. Since you have no transcript text, describe why this time-interval is likely engaging based on standard video pacing.

Return a JSON array of these moments.`;
      transcriptText = '[No transcript available]';
    }

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt + '\n\nTranscript Content:\n' + transcriptText.substring(0, 80000) } // Limit characters to fit model context
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            moments: {
              type: 'ARRAY',
              description: 'List of extracted high potential moments',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING', description: 'Brief internal name of this moment' },
                  startTime: { type: 'STRING', description: 'Start time in format HH:MM:SS or MM:SS (must match transcript)' },
                  endTime: { type: 'STRING', description: 'End time in format HH:MM:SS or MM:SS (must match transcript)' },
                  viralityScore: { type: 'INTEGER', description: 'Score between 0 and 100 representing viral potential' },
                  justification: { type: 'STRING', description: 'Explain why this segment is viral (e.g. dramatic hook, key question, humor)' },
                  shortTitle: { type: 'STRING', description: 'A catchy, clickable Title for the Shorts video (under 60 chars)' },
                  shortDescription: { type: 'STRING', description: 'An optimized short description with 3-4 trending hashtags' },
                  thumbnailConcept: { type: 'STRING', description: 'Visual idea for the thumbnail' }
                },
                required: ['title', 'startTime', 'endTime', 'viralityScore', 'justification', 'shortTitle', 'shortDescription', 'thumbnailConcept']
              }
            }
          },
          required: ['moments']
        }
      }
    };

    const chosenModel = aiModelSelect.value;
    const defaultModels = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'];
    const models = [chosenModel, ...defaultModels.filter(m => m !== chosenModel)];
    let resJson = null;
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`Attempting analysis with model: ${model}`);
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (res.ok) {
          resJson = await res.json();
          break; // Succeeded!
        }
        
        const errText = await res.text();
        console.warn(`Model ${model} returned error status ${res.status}: ${errText}`);
        
        // Parse error message if possible to show to user
        let errorMsg = errText;
        try {
          const parsedErr = JSON.parse(errText);
          if (parsedErr.error && parsedErr.error.message) {
            errorMsg = parsedErr.error.message;
          }
        } catch(e) {}
        
        // Quota (429), Permission (403), or Request Format (400) - throw immediately without fallback
        if (res.status === 400 || res.status === 403 || res.status === 429) {
          throw new Error(`Gemini API Error (${model}): ${res.status}. ${errorMsg}`);
        }
        
        const currentError = new Error(`Gemini API Error (${model}): ${res.status}. ${errorMsg}`);
        
        // Ignore 404 errors for fallback models to keep the original 503 error
        if (res.status === 404 && lastError) {
          // Do not overwrite lastError
        } else {
          lastError = currentError;
        }
      } catch (err) {
        console.warn(`Failed connection for model ${model}:`, err);
        // Throw immediately if it's our thrown custom error from above
        if (err.message && err.message.includes('Gemini API Error')) {
          throw err;
        }
        lastError = err;
      }
    }

    if (!resJson) {
      throw lastError || new Error('All model analysis attempts failed.');
    }
    
    try {
      const text = resJson.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(text);
      return parsed.moments || [];
    } catch (e) {
      console.error('Failed to parse Gemini response', resJson, e);
      throw new Error('Failed to parse AI moments from response payload.');
    }
  }

  // Fallback heuristic analyzer (demo mode)
  function generateFallbackMoments(videoData) {
    const duration = videoData.duration || 600;
    const moments = [];
    
    // Helper to format seconds
    const formatTime = (secs) => {
      const mins = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    if (videoData.transcript && videoData.transcript.length > 5) {
      // Find 3 segments containing high-energy words or questions, or split evenly
      const size = videoData.transcript.length;
      const segmentIndexes = [
        Math.floor(size * 0.15),
        Math.floor(size * 0.45),
        Math.floor(size * 0.75)
      ];
      
      segmentIndexes.forEach((idx, i) => {
        const startCue = videoData.transcript[idx];
        // Short clip duration: around 45 seconds
        let endIdx = idx;
        let runningDuration = 0;
        
        while (endIdx < size - 1 && runningDuration < 45) {
          endIdx++;
          // Rough duration calculation
          runningDuration = parseSecs(videoData.transcript[endIdx].end) - parseSecs(startCue.start);
        }
        
        const endCue = videoData.transcript[endIdx];
        
        moments.push({
          title: `Viral Moment Highlight #${i+1}`,
          startTime: startCue.start.split('.')[0], // Remove millisecond fraction for display
          endTime: endCue.end.split('.')[0],
          viralityScore: 85 + (i * 4),
          justification: 'This moment covers a key discussion shift in the transcript, containing strong semantic transitions and summaries.',
          shortTitle: `Wait for it! 😱 | ${videoData.title.substring(0, 30)}...`,
          shortDescription: `You will not believe this segment! Check out this highlight from the full video.\n\n#shorts #trending #viral #${videoData.channel.replace(/\s+/g, '')}`,
          thumbnailConcept: `Close-up expressive face reacting, high contrast overlay text reading "HE SAID WHAT?!"`
        });
      });
    } else {
      // Fallback based on metadata duration
      const clips = [
        { start: Math.floor(duration * 0.1), end: Math.floor(duration * 0.1) + 40 },
        { start: Math.floor(duration * 0.4), end: Math.floor(duration * 0.4) + 40 }
      ];
      
      clips.forEach((clip, i) => {
        moments.push({
          title: `Video Segment Highlight #${i+1}`,
          startTime: formatTime(clip.start),
          endTime: formatTime(clip.end),
          viralityScore: 82 + (i * 5),
          justification: 'Automatically segmented from the video timeline based on general video structure guides.',
          shortTitle: `${videoData.title.substring(0, 45)}...`,
          shortDescription: `An amazing clip from our latest upload. Watch the full version on YouTube!\n\n#viral #shorts #highlight`,
          thumbnailConcept: `Bold graphic title text banner with vibrant gradient and split image layout`
        });
      });
    }
    
    return moments;
  }

  function parseSecs(timeStr) {
    const parts = timeStr.split(':');
    let secs = 0;
    if (parts.length === 3) {
      secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      secs = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    } else {
      secs = parseFloat(parts[0]);
    }
    return secs;
  }

  // Display metadata and generated moments in Dashboard
  function displayResults(videoData, moments) {
    // Hide status card, show dashboard
    statusCard.classList.add('hidden');
    dashboard.classList.remove('hidden');

    // Video Details
    videoThumbnail.src = videoData.thumbnail;
    videoDuration.textContent = formatSecsToDisplay(videoData.duration);
    videoTitle.textContent = videoData.title;
    videoChannel.textContent = videoData.channel;
    videoDesc.textContent = videoData.description || 'No description available.';

    // Moments List
    momentsCount.textContent = `${moments.length} Found`;
    momentsList.innerHTML = '';

    if (!videoData.transcript || videoData.transcript.length === 0) {
      const warningBox = document.createElement('div');
      warningBox.className = 'concept-box';
      warningBox.style.marginBottom = '16px';
      warningBox.style.borderColor = 'var(--warning)';
      warningBox.style.backgroundColor = 'rgba(245, 158, 11, 0.05)';
      warningBox.innerHTML = `<p style="color: var(--warning);"><i class="fa-solid fa-triangle-exclamation"></i> <strong>No Transcript Available:</strong> Highlights have been estimated across the video timeline based on title and description metadata.</p>`;
      momentsList.appendChild(warningBox);
    }

    moments.forEach((moment, idx) => {
      const card = document.createElement('div');
      card.className = 'card moment-card';
      
      let rankBadgeHtml = '';
      if (idx === 0) {
        rankBadgeHtml = `<span class="badge badge-rank-1"><i class="fa-solid fa-trophy"></i> Rank #1 (Highly Recommended)</span>`;
      } else if (idx === 1) {
        rankBadgeHtml = `<span class="badge badge-rank-2"><i class="fa-solid fa-medal"></i> Rank #2</span>`;
      } else if (idx === 2) {
        rankBadgeHtml = `<span class="badge badge-rank-3"><i class="fa-solid fa-medal"></i> Rank #3</span>`;
      } else {
        rankBadgeHtml = `<span class="badge badge-secondary">Rank #${idx + 1}</span>`;
      }
      
      card.innerHTML = `
        <div class="moment-header">
          <div class="moment-info">
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              ${rankBadgeHtml}
            </div>
            <h3>${moment.title}</h3>
            <span class="moment-time"><i class="fa-solid fa-stopwatch"></i> ${moment.startTime} - ${moment.endTime}</span>
          </div>
          <div class="virality-score">
            <i class="fa-solid fa-fire"></i> ${moment.viralityScore}%
          </div>
        </div>
        <p class="moment-justification">${moment.justification}</p>
        
        <div class="moment-meta-details">
          <div class="meta-detail-box">
            <h4><i class="fa-solid fa-heading"></i> Shorts Title</h4>
            <p>${moment.shortTitle}</p>
          </div>
          <div class="meta-detail-box">
            <h4><i class="fa-solid fa-image"></i> Thumbnail Design</h4>
            <p>${moment.thumbnailConcept}</p>
          </div>
        </div>

        <button class="btn btn-primary btn-generate" data-index="${idx}">
          <i class="fa-solid fa-scissors"></i> Generate Short Video
        </button>
      `;

      momentsList.appendChild(card);
    });

    // Add event listeners to "Generate Short" buttons
    momentsList.querySelectorAll('.btn-generate').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const index = e.currentTarget.getAttribute('data-index');
        const moment = currentMoments[index];
        await generateShortVideo(moment);
      });
    });
  }

  // Generate short video by calling backend
  async function generateShortVideo(moment) {
    // Show loading overlay
    dashboard.classList.add('hidden');
    statusCard.classList.remove('hidden');
    updateStatus('Initializing Video Crop...', 'Preparing layout parameters. Sending clip window to processing server...', 10);

    const startTime = moment.startTime;
    const endTime = moment.endTime;
    const overlaySubs = overlaySubsCheckbox.checked;
    const addAlerts = addAlertsCheckbox.checked;

    let elapsed = 0;
    const startTimeStamp = Date.now();

    // Track progress and elapsed time dynamically
    const progressInterval = setInterval(() => {
      elapsed = Math.floor((Date.now() - startTimeStamp) / 1000);
      
      const currentWidth = parseFloat(statusProgress.style.width) || 10;
      let nextWidth = currentWidth;
      
      if (currentWidth < 90) {
        nextWidth = currentWidth + (currentWidth < 60 ? 3 : 1);
      }
      
      if (elapsed < 10) {
        updateStatus(
          'Downloading Video Segment...', 
          `Downloading the selected clip from YouTube. Elapsed time: ${elapsed}s.`, 
          nextWidth
        );
      } else {
        updateStatus(
          'Processing & Rendering Video...', 
          `Cropping to 9:16 vertical, scaling to 720p, and rendering subtitle overlays. Elapsed time: ${elapsed}s. (4K and HD videos take longer, please do not close this tab).`, 
          nextWidth
        );
      }
    }, 1000);

    try {
      // Call backend `/api/generate-short`
      const response = await fetch('/api/generate-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentVideoData.id, // we can just send the video id or URL
          startTime,
          endTime,
          transcript: currentVideoData.transcript,
          overlaySubs,
          addAlerts
        })
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to render short video.');
      }

      const result = await response.json();
      console.log('Short generated successfully:', result);

      updateStatus('Short Completed!', 'Finalizing preview video rendering.', 100);
      
      // Load modal data
      shortsVideo.src = result.videoUrl;
      btnDownloadShort.href = result.videoUrl;
      
      shortDisplayTitle.textContent = moment.title;
      shortDisplayReason.textContent = moment.justification;
      shortTitleText.textContent = moment.shortTitle;
      shortDescText.textContent = moment.shortDescription;
      shortThumbnailText.textContent = moment.thumbnailConcept;
      
      // Open modal
      setTimeout(() => {
        statusCard.classList.add('hidden');
        dashboard.classList.remove('hidden');
        videoModal.classList.remove('hidden');
        shortsVideo.play();
      }, 800);

    } catch (err) {
      console.error(err);
      alert('Error generating short: ' + err.message);
      statusCard.classList.add('hidden');
      dashboard.classList.remove('hidden');
    }
  }

  // Format Helper: Seconds to MM:SS or HH:MM:SS
  function formatSecsToDisplay(secs) {
    if (!secs) return '00:00';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Close Modal Handler
  btnCloseModal.addEventListener('click', () => {
    videoModal.classList.add('hidden');
    shortsVideo.pause();
    shortsVideo.src = '';
  });

  // Click outside modal to close
  videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) {
      videoModal.classList.add('hidden');
      shortsVideo.pause();
      shortsVideo.src = '';
    }
  });

  // Copy Buttons handler
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetId = e.currentTarget.getAttribute('data-target');
      const textToCopy = document.getElementById(targetId).textContent;
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        // Visual feedback
        const icon = e.currentTarget.querySelector('i');
        icon.className = 'fa-solid fa-check';
        icon.style.color = 'var(--success)';
        
        setTimeout(() => {
          icon.className = 'fa-solid fa-copy';
          icon.style.color = '';
        }, 1500);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
      });
    });
  });
});
