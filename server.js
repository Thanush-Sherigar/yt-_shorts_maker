const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const PROJECT_DIR = __dirname;
const BIN_DIR = path.join(PROJECT_DIR, 'bin');
const TEMP_DIR = path.join(PROJECT_DIR, 'temp');
const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const SHORTS_DIR = path.join(PUBLIC_DIR, 'shorts');

const isWin = process.platform === 'win32';
const YT_DLP_PATH = path.join(BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const YT_DLP_URL = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

// Middleware
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Ensure directories exist
[BIN_DIR, TEMP_DIR, PUBLIC_DIR, SHORTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Check if YouTube cookies environment variable is set
const cookiesPath = path.join(PROJECT_DIR, 'cookies.txt');
if (process.env.YT_DLP_COOKIES) {
  try {
    fs.writeFileSync(cookiesPath, process.env.YT_DLP_COOKIES, 'utf8');
    console.log('Successfully wrote cookies.txt from environment variable.');
  } catch (err) {
    console.error('Failed to write cookies.txt from environment variable:', err);
  }
}

// Helper to append cookies argument to yt-dlp if cookies file is present
function getYtDlpArgs(baseArgs) {
  if (fs.existsSync(cookiesPath)) {
    return [...baseArgs, '--cookies', cookiesPath];
  }
  return baseArgs;
}

// Ensure local font exists for FFmpeg drawtext filter (avoids Fontconfig/escaped colon drive path issues)
const sysFontPath = 'C:\\Windows\\Fonts\\arial.ttf';
const localFontPath = path.join(PROJECT_DIR, 'arial.ttf');
if (!fs.existsSync(localFontPath) && fs.existsSync(sysFontPath)) {
  try {
    fs.copyFileSync(sysFontPath, localFontPath);
    console.log('Copied arial.ttf to project root.');
  } catch (err) {
    console.warn('Failed to copy system font:', err);
  }
}

// Helper: Download file with redirect support
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    function get(url) {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: Status ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

// Helper: Check and bootstrap yt-dlp
async function ensureYtDlp() {
  if (!fs.existsSync(YT_DLP_PATH)) {
    console.log(`yt-dlp not found. Downloading from ${YT_DLP_URL}...`);
    try {
      await downloadFile(YT_DLP_URL, YT_DLP_PATH);
      console.log('yt-dlp downloaded successfully.');
      if (!isWin) {
        fs.chmodSync(YT_DLP_PATH, '755');
        console.log('Set execute permission on yt-dlp.');
      }
    } catch (error) {
      console.error('Error downloading yt-dlp:', error);
      throw error;
    }
  } else {
    console.log('yt-dlp is already installed.');
  }
}

// Helper: Run subprocess with promise wrapper
function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${file} ${args.join(' ')}`);
    execFile(file, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Time parsing helper
function timeToSec(timeStr) {
  const parts = timeStr.split(':');
  let hrs = 0, mins = 0, secs = 0;
  if (parts.length === 3) {
    hrs = parseFloat(parts[0]);
    mins = parseFloat(parts[1]);
    secs = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    mins = parseFloat(parts[0]);
    secs = parseFloat(parts[1]);
  } else {
    secs = parseFloat(parts[0]);
  }
  return hrs * 3600 + mins * 60 + secs;
}

// Format seconds to HH:MM:SS.mmm
function secToTime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':') + '.' + ms.toString().padStart(3, '0');
}

// VTT subtitle parser and cleaner
function parseVtt(vttContent) {
  const lines = vttContent.split(/\r?\n/);
  const cues = [];
  let currentCue = null;
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    if (line.includes('-->')) {
      const parts = line.split('-->');
      const start = parts[0].trim();
      const end = parts[1].trim();
      currentCue = { start, end, text: '' };
      cues.push(currentCue);
    } else if (currentCue && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && !line.startsWith('Kind:') && !line.startsWith('Language:')) {
      // Clean inline html/timing tags like <c>hello</c> or <00:00:01.000>
      const cleanText = line.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
      if (cleanText) {
        if (currentCue.text) {
          currentCue.text += ' ' + cleanText;
        } else {
          currentCue.text = cleanText;
        }
      }
    }
  }
  
  // Merge duplicates/building-up sentences from auto-captions
  const mergedCues = [];
  for (const cue of cues) {
    if (!cue.text) continue;
    
    const last = mergedCues[mergedCues.length - 1];
    
    if (last && last.text === cue.text) {
      last.end = cue.end;
    } else if (last && (timeToSec(cue.start) - timeToSec(last.end) < 0.8) && (cue.text.startsWith(last.text) || last.text.endsWith(cue.text))) {
      // If text builds up, update the text and end time
      if (cue.text.length > last.text.length) {
        last.text = cue.text;
        last.end = cue.end;
      }
    } else {
      mergedCues.push({
        start: cue.start,
        end: cue.end,
        text: cue.text
      });
    }
  }
  
  // Clean up any remaining overlaps or duplicate phrase transitions
  const finalCues = [];
  for (const cue of mergedCues) {
    const text = cue.text.trim();
    if (!text) continue;
    
    // Sometimes auto-subs have redundant repeated lines, filter them
    const last = finalCues[finalCues.length - 1];
    if (last && last.text === text) {
      last.end = cue.end;
    } else {
      finalCues.push(cue);
    }
  }
  
  return finalCues;
}

// Convert cue structures back to SubRip (.srt) format for ffmpeg rendering
function convertCuesToSrt(cues, clipStartSec) {
  let srtContent = '';
  let index = 1;
  
  for (const cue of cues) {
    const startSec = timeToSec(cue.start) - clipStartSec;
    const endSec = timeToSec(cue.end) - clipStartSec;
    
    // Only write subtitles that fall inside the clip window
    if (startSec >= 0) {
      // Convert period to comma for SRT standard format
      const startSrt = secToTime(startSec).replace('.', ',');
      const endSrt = secToTime(endSec).replace('.', ',');
      
      // Clean text
      const cleanText = cue.text
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
        
      srtContent += `${index}\n${startSrt} --> ${endSrt}\n${cleanText}\n\n`;
      index++;
    }
  }
  return srtContent;
}

// API: Analyze Video & Extract Transcript
app.get('/api/analyze', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }
  
  try {
    const videoId = `vid_${Date.now()}`;
    const infoJsonPath = path.join(TEMP_DIR, `${videoId}.json`);
    
    console.log(`Analyzing video URL: ${url}`);
    
    // 1. Fetch metadata using yt-dlp
    await runProcess(YT_DLP_PATH, getYtDlpArgs([
      '--skip-download',
      '--dump-json',
      '-o', path.join(TEMP_DIR, videoId),
      url
    ])).then(result => {
      fs.writeFileSync(infoJsonPath, result.stdout);
    });
    
    const metadata = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
    
    // Clean up temporary info json file
    try { fs.unlinkSync(infoJsonPath); } catch (e) {}
    
    // 2. Fetch English transcripts
    console.log(`Downloading subtitles/transcript for video: ${metadata.id}`);
    const subPrefix = path.join(TEMP_DIR, `${videoId}_subs`);
    
    try {
      await runProcess(YT_DLP_PATH, getYtDlpArgs([
        '--skip-download',
        '--write-auto-subs',
        '--write-subs',
        '--sub-langs', 'en',
        '--sub-format', 'vtt',
        '-o', subPrefix,
        url
      ]));
    } catch (subErr) {
      console.log('Error downloading English subtitles. Video might not have English subtitles.', subErr);
    }
    
    // Check if subtitle file exists
    // Subtitle file will be named like: temp/vid_XXX_subs.en.vtt or temp/vid_XXX_subs.en-US.vtt etc.
    const files = fs.readdirSync(TEMP_DIR);
    const subFile = files.find(f => f.startsWith(`${videoId}_subs`) && f.endsWith('.vtt'));
    
    let transcriptCues = [];
    if (subFile) {
      const subFilePath = path.join(TEMP_DIR, subFile);
      const vttContent = fs.readFileSync(subFilePath, 'utf8');
      transcriptCues = parseVtt(vttContent);
      
      // Clean up subtitle file
      try { fs.unlinkSync(subFilePath); } catch (e) {}
    }
    
    res.json({
      id: metadata.id,
      title: metadata.title,
      description: metadata.description,
      duration: metadata.duration, // in seconds
      thumbnail: metadata.thumbnail,
      channel: metadata.channel,
      transcript: transcriptCues
    });
    
  } catch (error) {
    console.error('Error during video analysis:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze video.' });
  }
});

// API: Generate Short from segment
app.post('/api/generate-short', async (req, res) => {
  const { url, startTime, endTime, transcript, overlaySubs, addAlerts } = req.body;
  
  if (!url || startTime === undefined || endTime === undefined) {
    return res.status(400).json({ error: 'URL, startTime, and endTime are required' });
  }
  
  const startSec = timeToSec(startTime.toString());
  const endSec = timeToSec(endTime.toString());
  const durationSec = endSec - startSec;
  
  if (durationSec <= 0 || durationSec > 90) {
    return res.status(400).json({ error: 'Short duration must be between 1 and 90 seconds (recommended under 60 seconds)' });
  }
  
  const shortId = `short_${Date.now()}`;
  const rawClipPath = path.join(TEMP_DIR, `${shortId}_raw.mp4`);
  const finalClipPath = path.join(SHORTS_DIR, `${shortId}.mp4`);
  const srtPath = path.join(TEMP_DIR, `${shortId}_subs.srt`);
  
  try {
    console.log(`Generating short for: ${url} [${startTime} - ${endTime}]`);
    
    // 1. Download specific section only using yt-dlp
    // We pass ffmpeg path to yt-dlp so it can cut it
    await runProcess(YT_DLP_PATH, getYtDlpArgs([
      '--ffmpeg-location', ffmpegPath,
      '--download-sections', `*${startSec}-${endSec}`,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', rawClipPath,
      url
    ]));
    
    if (!fs.existsSync(rawClipPath)) {
      throw new Error('Downloaded video clip not found. Download failed.');
    }
    
    // 2. Crop to 9:16 and scale to standard 1080p vertical (1080x1920) for high-definition shorts and consistent text sizes
    // We prepended setpts=PTS-STARTPTS to reset clip timestamps to 0, ensuring 'between(t,3,8)' matches clip relative time rather than stream absolute time
    let filterString = 'setpts=PTS-STARTPTS,crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920';
    
    if (overlaySubs && transcript && transcript.length > 0) {
      // Generate srt contents relative to the clip start time
      const srtContent = convertCuesToSrt(transcript, startSec);
      fs.writeFileSync(srtPath, srtContent, 'utf8');
      
      // Use relative path for subtitles filter to avoid Windows drive letter colon syntax issues in ffmpeg
      const relativeSrtPath = path.relative(PROJECT_DIR, srtPath).replace(/\\/g, '/');
      
      // Subtitle styling: White text, bold, fine outline, centered middle alignment (10) with no shadow and smooth edges (Outline=1)
      filterString += `,subtitles=${relativeSrtPath}:force_style='FontName=Arial,Alignment=10,FontSize=15,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=1,Shadow=0,Bold=1,MarginV=0'`;
    }

    if (addAlerts) {
      // Draw a solid red box in the lower section of the screen, appearing between second 3 and 8 of the clip (300x50px box for 1080p)
      filterString += `,drawbox=y=ih-250:x=(iw-300)/2:w=300:h=50:color=#ef4444@0.9:t=fill:enable='between(t,3,8)'`;
      // Draw white text 'LIKE AND SUBSCRIBE' on top of it, centering it horizontally and vertically
      filterString += `,drawtext=text='LIKE AND SUBSCRIBE':y=H-232:x=(W-tw)/2:fontcolor=white:fontsize=15:fontfile=arial.ttf:enable='between(t,3,8)'`;
    }
    
    console.log(`Running ffmpeg crop filter: ${filterString}`);
    
    // Run ffmpeg process
    await runProcess(ffmpegPath, [
      '-y',
      '-ss', '0', // Seek to 0 to align input demux starting timestamps to 0 (improves A/V sync)
      '-i', rawClipPath,
      '-vf', filterString,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      finalClipPath
    ]);
    
    // Clean up temporary files
    try { fs.unlinkSync(rawClipPath); } catch (e) {}
    try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch (e) {}
    
    res.json({
      success: true,
      videoUrl: `/shorts/${shortId}.mp4`,
      filename: `${shortId}.mp4`
    });
    
  } catch (error) {
    console.error('Error generating short:', error);
    // Cleanup on error
    try { if (fs.existsSync(rawClipPath)) fs.unlinkSync(rawClipPath); } catch (e) {}
    try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch (e) {}
    res.status(500).json({ error: error.message || 'Failed to crop and process video.' });
  }
});

// Start server after bootstrapping yt-dlp
ensureYtDlp().then(() => {
  app.listen(PORT, () => {
    console.log(`YouTube Shorts Maker server is running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server due to bootstrap errors:', err);
});
