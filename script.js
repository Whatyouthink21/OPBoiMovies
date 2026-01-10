import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, getDoc, addDoc, query, orderBy, limit, where, getDocs, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDFDQG_-vhIYXWtRUW5dXOvP_BCsCIhLJI",
    authDomain: "opboimovies.firebaseapp.com",
    projectId: "opboimovies",
    storageBucket: "opboimovies.firebasestorage.app",
    messagingSenderId: "436070860394",
    appId: "1:436070860394:web:c3443eba4bba154a14ec13",
    measurementId: "G-5C425WE7H6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Constants
const KEY = 'a45420333457411e78d5ad35d6c51a2d';
const OMDB_KEY = '8d8b4e0b'; // Free API key

const servers = [
    {id:'bidsrc', n:'BidSrc Pro'},
    {id:'cinemaos', n:'Aura Primary'},
    {id:'vidsrcto', n:'Aura Mirror'},
    {id:'vidsrcme', n:'Aura Legacy'},
    {id:'vidsrcicu', n:'Aura Stream'},
    {id:'2embed', n:'Aura Cloud'}
];

// Global State
let mode = 'movie';
let activeID = null;
let currentSrv = 'bidsrc';
let s = 1;
let e = 1;
let activeItem = null;
let myList = [];
let currentUser = null;
let searchTimeout;
let userRating = 0;
let randomGenre = null;
let quizScore = 0;
let quizTotal = 0;
let currentQuizMovie = null;

// Authentication Functions
window.login = async () => { 
    try { 
        await signInWithPopup(auth, provider); 
    } catch(error) { 
        console.error(error); 
        alert("Login Error: Make sure your domain is authorized in Firebase Console."); 
    } 
};

window.logout = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const loginBtn = document.getElementById('login-btn');
    const userProfile = document.getElementById('user-profile');
    
    if (user) {
        loginBtn.classList.add('hidden');
        userProfile.classList.remove('hidden');
        document.getElementById('user-name').innerText = user.displayName.split(' ')[0];
        document.getElementById('user-pic').src = user.photoURL;
        syncCloudList(user.uid);
        syncContinueWatching(user.uid);
        loadRecommendations();
        checkAchievements();
    } else {
        loginBtn.classList.remove('hidden');
        userProfile.classList.add('hidden');
        myList = [];
        updateListUI();
        document.getElementById('recommended-section').classList.add('hidden');
    }
});

function syncCloudList(uid) {
    onSnapshot(collection(db, "users", uid, "mylist"), (snap) => {
        myList = snap.docs.map(d => d.data());
        updateListUI();
        updateBtnStates();
    });
}

window.toggleMyList = async () => {
    if (!currentUser) return alert("Login to save to collection");
    const docRef = doc(db, "users", currentUser.uid, "mylist", activeItem.id.toString());
    const exists = myList.some(x => x.id === activeItem.id);
    
    if(exists) {
        await deleteDoc(docRef);
    } else {
        await setDoc(docRef, activeItem);
        await trackStats('list_add');
    }
};

// Watch Progress System
async function saveWatchProgress(itemId, progress, duration) {
    if (!currentUser) return;
    
    const progressRef = doc(db, "users", currentUser.uid, "progress", itemId.toString());
    await setDoc(progressRef, {
        id: itemId,
        progress: progress,
        duration: duration,
        timestamp: Date.now(),
        title: activeItem.title,
        poster_path: activeItem.poster_path,
        mode: mode,
        vote_average: activeItem.vote_average,
        ...(mode === 'tv' && { season: s, episode: e })
    });
    
    await trackStats(mode === 'movie' ? 'movie_watched' : 'episode_watched');
}

function syncContinueWatching(uid) {
    onSnapshot(collection(db, "users", uid, "progress"), (snap) => {
        const progressList = snap.docs.map(d => d.data());
        progressList.sort((a, b) => b.timestamp - a.timestamp);
        renderContinueWatching(progressList.slice(0, 6));
    });
}

function renderContinueWatching(list) {
    if(list.length === 0) {
        document.getElementById('continue-watching-section').classList.add('hidden');
        return;
    }
    
    document.getElementById('continue-watching-section').classList.remove('hidden');
    document.getElementById('continue-watching-grid').innerHTML = list.map(item => {
        const progressPercent = ((item.progress / item.duration) * 100).toFixed(0);
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        
        return `
        <div class="movie-card" onclick="resumeWatching(${item.id}, '${item.mode}', ${item.season || 1}, ${item.episode || 1})">
            <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" alt="${item.title}">
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="card-info">
                <div class="flex items-center justify-between mb-2">
                    <span class="rating-star">★ ${rating}</span>
                </div>
                <h4>${item.title}</h4>
                <p class="text-xs opacity-60">${progressPercent}% watched</p>
            </div>
        </div>`;
    }).join('');
}

window.resumeWatching = async (id, itemMode, season = 1, ep = 1) => {
    mode = itemMode;
    s = season;
    e = ep;
    updateModeButtons();
    
    const details = await fetch(`https://api.themoviedb.org/3/${mode}/${id}?api_key=${KEY}`).then(r => r.json());
    openPlayer(id, details.title || details.name, details.poster_path, details.vote_average, details.release_date || details.first_air_date);
};

// External Ratings (Feature 11)
async function getExternalRatings(title, year) {
    try {
        const response = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(title)}&y=${year}&type=movie`);
        const data = await response.json();
        
        if(data.Response === 'True') {
            return {
                imdb: data.imdbRating !== 'N/A' ? data.imdbRating : null,
                rotten: data.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value || null,
                metacritic: data.Ratings?.find(r => r.Source === 'Metacritic')?.Value || null
            };
        }
        return null;
    } catch(e) {
        console.error('Failed to fetch external ratings:', e);
        return null;
    }
}

// Search Overlay Functions
window.openSearchOverlay = () => {
    document.getElementById('search-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('search-input').focus();
};

window.closeSearchOverlay = () => {
    document.getElementById('search-overlay').classList.remove('active');
    document.body.style.overflow = 'auto';
    document.getElementById('search-input').value = '';
    document.getElementById('search-results-container').innerHTML = `
        <div class="search-placeholder">
            <div class="search-placeholder-icon">🎬</div>
            <p>Start typing to search...</p>
        </div>
    `;
};

document.getElementById('search-input').addEventListener('input', async (ev) => {
    clearTimeout(searchTimeout);
    const val = ev.target.value.trim();
    const resultsContainer = document.getElementById('search-results-container');
    
    if(val.length < 2) {
        resultsContainer.innerHTML = `
            <div class="search-placeholder">
                <div class="search-placeholder-icon">🎬</div>
                <p>Start typing to search...</p>
            </div>
        `;
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        const r = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${KEY}&query=${val}`);
        const d = await r.json();
        const results = d.results
            .filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path)
            .slice(0, 12);
        
        if(results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <div class="search-placeholder-icon">😕</div>
                    <p>No results found for "${val}"</p>
                </div>
            `;
        } else {
            resultsContainer.innerHTML = `
                <div class="search-results-grid">
                    ${results.map(m => {
                        const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
                        const year = (m.release_date || m.first_air_date || '').split('-')[0] || '';
                        const mediaType = m.media_type === 'movie' ? 'Movie' : 'Series';
                        const title = (m.title || m.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        
                        return `
                        <div class="search-result-card" onclick="selectSearchResult(${m.id}, '${m.media_type}', '${title}', '${m.poster_path}', ${m.vote_average || 0}, '${m.release_date || m.first_air_date || ''}')">
                            <div class="search-result-poster">
                                <img src="https://image.tmdb.org/t/p/w500${m.poster_path}" alt="${m.title || m.name}">
                            </div>
                            <div class="search-result-info">
                                <h4 class="search-result-title">${m.title || m.name}</h4>
                                <div class="search-result-meta">
                                    <span class="search-result-rating">★ ${rating}</span>
                                    <span class="search-result-year">${year}</span>
                                    <span class="search-result-type">${mediaType}</span>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        }
    }, 300);
});

window.selectSearchResult = (id, mediaType, title, poster, rating, releaseDate) => {
    const oldMode = mode;
    mode = mediaType;
    
    if(oldMode !== mode) {
        updateModeButtons();
    }
    
    closeSearchOverlay();
    openDetailsModal(id, mediaType);
};

// Main Init Function
async function init(q = '', g = '') {
    let url = `https://api.themoviedb.org/3/trending/${mode}/week?api_key=${KEY}`;
    if(q) url = `https://api.themoviedb.org/3/search/${mode}?api_key=${KEY}&query=${q}`;
    if(g) url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}&with_genres=${g}`;
    
    const r = await fetch(url);
    const d = await r.json();
    
    if(!q && !g && d.results[0]) setupHero(d.results[0]);
    renderGrid(d.results, 'grid');
    loadGenres();
}

// Hero Section
async function setupHero(m) {
    document.getElementById('hero-bg').style.backgroundImage = `url(https://image.tmdb.org/t/p/original${m.backdrop_path})`;
    document.getElementById('hero-title').innerText = m.title || m.name;
    
    const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
    document.getElementById('hero-rating').innerHTML = `★ ${rating}`;
    
    const year = (m.release_date || m.first_air_date || '').split('-')[0];
    document.getElementById('hero-year').innerText = year || '';
    
    const details = await fetch(`https://api.themoviedb.org/3/${mode}/${m.id}?api_key=${KEY}`).then(r => r.json());
    document.getElementById('hero-description').innerText = details.overview || 'No description available.';
    
    activeItem = { 
        id: m.id, 
        title: m.title || m.name, 
        poster_path: m.poster_path, 
        mode, 
        vote_average: m.vote_average, 
        release_date: m.release_date, 
        first_air_date: m.first_air_date 
    };
    
    document.getElementById('hero-play').onclick = () => openPlayer(
        m.id, 
        m.title || m.name, 
        m.poster_path, 
        m.vote_average, 
        m.release_date || m.first_air_date
    );
    document.getElementById('hero-add').onclick = () => toggleMyList();
    document.getElementById('hero-info').onclick = () => openDetailsModal(m.id, mode);
    document.getElementById('hero-share').onclick = () => shareContent();
    updateBtnStates();
}

// Render Grid
function renderGrid(list, target) {
    document.getElementById(target).innerHTML = list.map(m => {
        if(!m.poster_path) return '';
        
        const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
        const year = (m.release_date || m.first_air_date || '').split('-')[0] || '';
        const title = (m.title || m.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        return `
        <div class="movie-card" onclick="openDetailsModal(${m.id}, '${m.media_type || mode}')">
            <img src="https://image.tmdb.org/t/p/w500${m.poster_path}" alt="${m.title || m.name}">
            <div class="card-info">
                <div class="flex items-center justify-between mb-2">
                    <span class="rating-star">★ ${rating}</span>
                    <span class="text-[9px] font-black uppercase opacity-40">${year}</span>
                </div>
                <h4 class="font-black text-xs uppercase tracking-tight line-clamp-1">${m.title || m.name}</h4>
            </div>
        </div>`;
    }).join('');
}

// Details Modal with ALL features
window.openDetailsModal = async (id, mediaType) => {
    const oldMode = mode;
    mode = mediaType;
    
    document.getElementById('details-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    const res = await fetch(`https://api.themoviedb.org/3/${mode}/${id}?api_key=${KEY}&append_to_response=credits,videos,similar`).then(r => r.json());
    
    // Backdrop
    if(res.backdrop_path) {
        document.getElementById('details-backdrop').style.backgroundImage = `url(https://image.tmdb.org/t/p/original${res.backdrop_path})`;
    }
    
    // Get External Ratings (Feature 11)
    const externalRatings = await getExternalRatings(res.title || res.name, (res.release_date || res.first_air_date || '').split('-')[0]);
    
    // Multiple Rating Sources
    document.getElementById('details-rating').innerHTML = `
        <span class="rating-badge" style="background: rgba(234, 179, 8, 0.2); border: 1px solid rgba(234, 179, 8, 0.4); color: #fbbf24;">
            ⭐ TMDB ${res.vote_average ? res.vote_average.toFixed(1) : 'N/A'}
        </span>
        ${externalRatings?.imdb ? `
        <span class="rating-badge" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b;">
            🎬 IMDB ${externalRatings.imdb}
        </span>` : ''}
        ${externalRatings?.rotten ? `
        <span class="rating-badge" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444;">
            🍅 ${externalRatings.rotten}
        </span>` : ''}
        ${externalRatings?.metacritic ? `
        <span class="rating-badge" style="background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); color: #22c55e;">
            Ⓜ️ ${externalRatings.metacritic}
        </span>` : ''}
    `;
    
    // Basic Info
    document.getElementById('details-title').innerText = res.title || res.name;
    document.getElementById('details-year').innerText = (res.release_date || res.first_air_date || '').split('-')[0];
    document.getElementById('details-runtime').innerText = res.runtime ? `${res.runtime}min` : (res.episode_run_time?.[0] ? `${res.episode_run_time[0]}min/ep` : 'N/A');
    document.getElementById('details-overview').innerText = res.overview || 'No description available.';
    
    // Genres
    document.getElementById('details-genres').innerHTML = res.genres?.map(g => 
        `<span style="background: var(--glass); padding: 8px 16px; border-radius: 20px; font-size: 11px; font-weight: 800; border: 1px solid var(--glass-border);">${g.name}</span>`
    ).join('') || '';
    
    // Stats
    document.getElementById('details-status').innerText = res.status || 'N/A';
    document.getElementById('details-language').innerText = res.original_language?.toUpperCase() || 'N/A';
    document.getElementById('details-budget').innerText = res.budget ? `$${(res.budget / 1000000).toFixed(1)}M` : 'N/A';
    
    // Cast with clickable actors (Feature 15)
    document.getElementById('details-cast').innerHTML = res.credits.cast.slice(0, 8).map(c => `
        <div style="cursor: pointer; transition: all 0.2s;" onclick="closeDetailsModal(); openActorPage(${c.id}, '${c.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
            ${c.profile_path ? `<img src="https://image.tmdb.org/t/p/w185${c.profile_path}" alt="${c.name}">` : '<div style="width: 50px; height: 50px; border-radius: 12px; background: var(--glass);"></div>'}
            <div>
                <p style="font-size: 12px; font-weight: 800;">${c.name}</p>
                <p style="font-size: 10px; opacity: 0.5;">${c.character}</p>
            </div>
        </div>
    `).join('');
    
    // Trailer
    const trailer = res.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    if(trailer) {
        document.getElementById('details-trailer').innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${trailer.key}" frameborder="0" allowfullscreen style="border-radius: 16px;"></iframe>`;
    } else {
        document.getElementById('details-trailer').innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.3;">No trailer available</div>';
    }
    
    // Similar
    document.getElementById('details-similar').innerHTML = res.similar.results.slice(0, 4).map(m => 
        m.poster_path ? `<img src="https://image.tmdb.org/t/p/w200${m.poster_path}" style="width: 100%; border-radius: 12px; cursor: pointer; border: 2px solid var(--glass-border); transition: all 0.3s;" onclick="openDetailsModal(${m.id}, '${mode}')" alt="${m.title || m.name}">` : ''
    ).join('');
    
    // Load Reviews (Feature 16)
    loadReviews(id);
    
    // Load Comments (Feature 18)
    loadComments(id);
    
    // Buttons
    activeItem = { id, title: res.title || res.name, poster_path: res.poster_path, mode, vote_average: res.vote_average };
    document.getElementById('details-play-btn').onclick = () => {
        closeDetailsModal();
        openPlayer(id, res.title || res.name, res.poster_path, res.vote_average, res.release_date || res.first_air_date);
    };
    document.getElementById('details-add-btn').onclick = toggleMyList;
    updateBtnStates();
    
    // Reset star rating
    userRating = 0;
    document.querySelectorAll('#star-rating .star-btn').forEach(star => {
        star.innerText = '☆';
        star.style.color = '';
    });
};

window.closeDetailsModal = () => {
    document.getElementById('details-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// User Reviews System (Feature 16)
window.rateMovie = (rating) => {
    if (!currentUser) return alert("Login to rate");
    userRating = rating;
    
    document.querySelectorAll('#star-rating .star-btn').forEach((star, index) => {
        if(index < rating) {
            star.innerText = '★';
            star.style.color = '#fbbf24';
        } else {
            star.innerText = '☆';
            star.style.color = '';
        }
    });
};

window.submitReview = async () => {
    if (!currentUser) return alert("Login to review");
    if (userRating === 0) return alert("Please rate first");
    
    const reviewText = document.getElementById('review-text').value.trim();
    if (!reviewText) return alert("Please write a review");
    
    const reviewData = {
        userId: currentUser.uid,
        userName: currentUser.displayName,
        userPhoto: currentUser.photoURL,
        movieId: activeItem.id,
        rating: userRating,
        review: reviewText,
        timestamp: Date.now()
    };
    
    await addDoc(collection(db, "reviews"), reviewData);
    await trackStats('review_written');
    
    document.getElementById('review-text').value = '';
    userRating = 0;
    document.querySelectorAll('#star-rating .star-btn').forEach(star => {
        star.innerText = '☆';
        star.style.color = '';
    });
    
    loadReviews(activeItem.id);
    alert("Review submitted!");
};

async function loadReviews(movieId) {
    const q = query(
        collection(db, "reviews"),
        where("movieId", "==", movieId),
        orderBy("timestamp", "desc"),
        limit(10)
    );
    
    const snapshot = await getDocs(q);
    const reviews = snapshot.docs.map(doc => doc.data());
    
    document.getElementById('reviews-container').innerHTML = reviews.map(review => `
        <div style="background: var(--glass); padding: 20px; border-radius: 16px; border: 1px solid var(--glass-border);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <img src="${review.userPhoto}" style="width: 40px; height: 40px; border-radius: 50%;">
                <div>
                    <div style="font-size: 14px; font-weight: 800;">${review.userName}</div>
                    <div style="font-size: 12px; color: #fbbf24;">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
                </div>
                <div style="margin-left: auto; font-size: 10px; opacity: 0.5;">
                    ${new Date(review.timestamp).toLocaleDateString()}
                </div>
            </div>
            <p style="font-size: 14px; line-height: 1.6;">${review.review}</p>
        </div>
    `).join('') || '<p style="opacity: 0.5; text-align: center;">No reviews yet. Be the first!</p>';
}

// Comments System (Feature 18)
window.submitComment = async () => {
    if (!currentUser) return alert("Login to comment");
    
    const commentText = document.getElementById('comment-text').value.trim();
    if (!commentText) return alert("Please write a comment");
    
    const commentData = {
        userId: currentUser.uid,
        userName: currentUser.displayName,
        userPhoto: currentUser.photoURL,
        movieId: activeItem.id,
        comment: commentText,
        timestamp: Date.now()
    };
    
    await addDoc(collection(db, "comments"), commentData);
    document.getElementById('comment-text').value = '';
    loadComments(activeItem.id);
};

async function loadComments(movieId) {
    const q = query(
        collection(db, "comments"),
        where("movieId", "==", movieId),
        orderBy("timestamp", "desc"),
        limit(20)
    );
    
    const snapshot = await getDocs(q);
    const comments = snapshot.docs.map(doc => doc.data());
    
    document.getElementById('comments-container').innerHTML = comments.map(comment => `
        <div style="background: var(--glass); padding: 16px; border-radius: 12px; border: 1px solid var(--glass-border);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                <img src="${comment.userPhoto}" style="width: 32px; height: 32px; border-radius: 50%;">
                <div style="flex: 1;">
                    <div style="font-size: 12px; font-weight: 800;">${comment.userName}</div>
                    <div style="font-size: 10px; opacity: 0.5;">${new Date(comment.timestamp).toLocaleDateString()}</div>
                </div>
            </div>
            <p style="font-size: 13px; line-height: 1.5;">${comment.comment}</p>
        </div>
    `).join('') || '<p style="opacity: 0.5; text-align: center;">No comments yet. Start the discussion!</p>';
}

// Share Functionality (Feature 17)
window.shareContent = () => {
    document.getElementById('share-modal').style.display = 'flex';
    const shareLink = `${window.location.origin}?movie=${activeItem.id}&mode=${mode}`;
    document.getElementById('share-link').value = shareLink;
};

window.closeShareModal = () => {
    document.getElementById('share-modal').style.display = 'none';
};

window.shareOn = (platform) => {
    const title = activeItem.title;
    const url = document.getElementById('share-link').value;
    
    let shareUrl = '';
    if(platform === 'twitter') {
        shareUrl = `https://twitter.com/intent/tweet?text=Check out ${title} on OPBoi Movies!&url=${encodeURIComponent(url)}`;
    } else if(platform === 'facebook') {
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    } else if(platform === 'whatsapp') {
        shareUrl = `https://wa.me/?text=Check out ${title} on OPBoi Movies! ${encodeURIComponent(url)}`;
    }
    
    window.open(shareUrl, '_blank', 'width=600,height=400');
};

window.copyShareLink = () => {
    const input = document.getElementById('share-link');
    input.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
};
// Actor/Director Pages (Feature 15)
window.openActorPage = async (actorId, actorName) => {
    document.getElementById('actor-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    const actorDetails = await fetch(`https://api.themoviedb.org/3/person/${actorId}?api_key=${KEY}`).then(r => r.json());
    const credits = await fetch(`https://api.themoviedb.org/3/person/${actorId}/combined_credits?api_key=${KEY}`).then(r => r.json());
    
    document.getElementById('actor-name').innerText = actorName;
    document.getElementById('actor-photo').src = actorDetails.profile_path ? `https://image.tmdb.org/t/p/w500${actorDetails.profile_path}` : '';
    document.getElementById('actor-bio').innerText = actorDetails.biography || 'No biography available.';
    document.getElementById('actor-birthday').innerText = actorDetails.birthday ? new Date(actorDetails.birthday).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
    document.getElementById('actor-birthplace').innerText = actorDetails.place_of_birth || 'Unknown';
    
    const filmography = credits.cast
        .filter(c => (c.media_type === 'movie' || c.media_type === 'tv') && c.poster_path)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 20);
    
    document.getElementById('actor-filmography').innerHTML = filmography.map(m => {
        const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
        const year = (m.release_date || m.first_air_date || '').split('-')[0] || '';
        
        return `
        <div class="movie-card" onclick="closeActorModal(); openDetailsModal(${m.id}, '${m.media_type}')">
            <img src="https://image.tmdb.org/t/p/w300${m.poster_path}" alt="${m.title || m.name}">
            <div class="card-info">
                <div class="flex items-center justify-between mb-2">
                    <span class="rating-star">★ ${rating}</span>
                    <span class="text-[9px] font-black uppercase opacity-40">${year}</span>
                </div>
                <h4 class="font-black text-xs uppercase tracking-tight line-clamp-1">${m.title || m.name}</h4>
                <p style="font-size: 9px; opacity: 0.5; margin-top: 4px;">as ${m.character || 'Unknown'}</p>
            </div>
        </div>`;
    }).join('');
};

window.closeActorModal = () => {
    document.getElementById('actor-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// Upcoming Releases Calendar (Feature 14)
async function loadUpcomingReleases() {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + 90);
    
    const url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}&primary_release_date.gte=${today.toISOString().split('T')[0]}&primary_release_date.lte=${futureDate.toISOString().split('T')[0]}&sort_by=popularity.desc`;
    
    const r = await fetch(url);
    const d = await r.json();
    
    return d.results.slice(0, 20);
}

window.showUpcomingCalendar = async () => {
    const upcoming = await loadUpcomingReleases();
    
    document.getElementById('calendar-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    document.getElementById('calendar-grid').innerHTML = upcoming.map(m => {
        const releaseDate = new Date(m.release_date || m.first_air_date);
        const dateStr = releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
        
        return `
        <div class="upcoming-card" onclick="closeCalendarModal(); openDetailsModal(${m.id}, '${mode}')">
            <img src="https://image.tmdb.org/t/p/w300${m.poster_path}" alt="${m.title || m.name}">
            <div style="padding: 16px;">
                <div style="background: linear-gradient(135deg, var(--primary), var(--accent)); display: inline-block; padding: 6px 12px; border-radius: 8px; font-size: 10px; font-weight: 900; margin-bottom: 8px;">
                    📅 ${dateStr}
                </div>
                <h4 style="font-size: 14px; font-weight: 900; margin-bottom: 8px;">${m.title || m.name}</h4>
                <div style="display: flex; gap: 8px;">
                    <span class="rating-star">★ ${rating}</span>
                </div>
            </div>
        </div>`;
    }).join('');
};

window.closeCalendarModal = () => {
    document.getElementById('calendar-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// AI Recommendations (Feature 20)
async function loadRecommendations() {
    if(!currentUser || myList.length === 0) {
        document.getElementById('recommended-section').classList.add('hidden');
        return;
    }
    
    // Get genres from user's watchlist
    const genreCounts = {};
    myList.forEach(item => {
        // In real implementation, you'd fetch full details for each item
        // For now, we'll use a simplified approach
    });
    
    // Get recommendations based on most watched genre
    const url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}&sort_by=vote_average.desc&vote_count.gte=100`;
    const r = await fetch(url);
    const d = await r.json();
    
    document.getElementById('recommended-section').classList.remove('hidden');
    renderGrid(d.results.slice(0, 12), 'recommended-grid');
}

// Statistics Dashboard (Feature 22)
async function trackStats(action) {
    if(!currentUser) return;
    
    const statsRef = doc(db, "users", currentUser.uid, "stats", "overall");
    const statsDoc = await getDoc(statsRef);
    
    if(!statsDoc.exists()) {
        await setDoc(statsRef, {
            movies_watched: 0,
            episodes_watched: 0,
            reviews_written: 0,
            list_adds: 0,
            hours_watched: 0,
            genres: {}
        });
    }
    
    const updates = {};
    if(action === 'movie_watched') {
        updates.movies_watched = increment(1);
        updates.hours_watched = increment(2); // Assume 2 hours per movie
    } else if(action === 'episode_watched') {
        updates.episodes_watched = increment(1);
        updates.hours_watched = increment(0.75); // Assume 45 min per episode
    } else if(action === 'review_written') {
        updates.reviews_written = increment(1);
    } else if(action === 'list_add') {
        updates.list_adds = increment(1);
    }
    
    await updateDoc(statsRef, updates);
}

window.openStatsModal = async () => {
    if(!currentUser) return alert("Login to view stats");
    
    document.getElementById('stats-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    const statsRef = doc(db, "users", currentUser.uid, "stats", "overall");
    const statsDoc = await getDoc(statsRef);
    
    if(statsDoc.exists()) {
        const stats = statsDoc.data();
        document.getElementById('stat-movies').innerText = stats.movies_watched || 0;
        document.getElementById('stat-series').innerText = Math.floor((stats.episodes_watched || 0) / 10); // Rough estimate
        document.getElementById('stat-hours').innerText = Math.floor(stats.hours_watched || 0);
        document.getElementById('stat-reviews').innerText = stats.reviews_written || 0;
        
        // Genre stats (simplified)
        document.getElementById('genre-stats').innerHTML = `
            <div style="background: var(--glass); padding: 12px 20px; border-radius: 12px; border: 1px solid var(--glass-border);">Action</div>
            <div style="background: var(--glass); padding: 12px 20px; border-radius: 12px; border: 1px solid var(--glass-border);">Drama</div>
            <div style="background: var(--glass); padding: 12px 20px; border-radius: 12px; border: 1px solid var(--glass-border);">Comedy</div>
        `;
    }
};

window.closeStatsModal = () => {
    document.getElementById('stats-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// Random Movie Picker (Feature 31)
window.openRandomPicker = () => {
    document.getElementById('random-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    randomGenre = null;
};

window.closeRandomModal = () => {
    document.getElementById('random-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

window.setRandomGenre = (genreId) => {
    randomGenre = genreId;
    
    // Update button styles
    document.querySelectorAll('#random-modal .control-btn').forEach(btn => {
        btn.style.background = 'var(--glass)';
        btn.style.border = '1px solid var(--glass-border)';
    });
    
    const activeBtn = genreId === null ? 'random-any' : `random-${genreId}`;
    const btn = document.getElementById(activeBtn);
    if(btn) {
        btn.style.background = 'linear-gradient(135deg, var(--primary), var(--accent))';
        btn.style.border = 'none';
    }
};

window.pickRandom = async () => {
    let url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}&sort_by=popularity.desc&vote_count.gte=100`;
    
    if(randomGenre) {
        url += `&with_genres=${randomGenre}`;
    }
    
    const r = await fetch(url);
    const d = await r.json();
    
    // Pick random from top 50
    const randomIndex = Math.floor(Math.random() * Math.min(50, d.results.length));
    const randomMovie = d.results[randomIndex];
    
    closeRandomModal();
    openDetailsModal(randomMovie.id, mode);
};

// Movie Quiz/Trivia (Feature 32)
window.openQuizModal = async () => {
    document.getElementById('quiz-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    quizScore = 0;
    quizTotal = 0;
    
    loadQuizQuestion();
};

window.closeQuizModal = () => {
    document.getElementById('quiz-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

async function loadQuizQuestion() {
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${KEY}`;
    const r = await fetch(url);
    const d = await r.json();
    
    // Pick random movie
    const randomIndex = Math.floor(Math.random() * d.results.length);
    currentQuizMovie = d.results[randomIndex];
    
    // Get 3 wrong answers
    const wrongAnswers = d.results
        .filter(m => m.id !== currentQuizMovie.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(m => m.title);
    
    // Shuffle answers
    const allAnswers = [currentQuizMovie.title, ...wrongAnswers].sort(() => 0.5 - Math.random());
    
    document.getElementById('quiz-poster').src = `https://image.tmdb.org/t/p/w300${currentQuizMovie.poster_path}`;
    document.getElementById('quiz-options').innerHTML = allAnswers.map(answer => `
        <button onclick="checkQuizAnswer('${answer.replace(/'/g, "\\'")}')" style="background: var(--glass); border: 1px solid var(--glass-border); padding: 16px; border-radius: 12px; color: white; font-weight: 800; cursor: pointer; transition: all 0.3s; font-size: 14px;">
            ${answer}
        </button>
    `).join('');
    
    document.getElementById('quiz-score-value').innerText = quizScore;
    document.getElementById('quiz-total').innerText = quizTotal;
}

window.checkQuizAnswer = async (answer) => {
    quizTotal++;
    
    if(answer === currentQuizMovie.title) {
        quizScore++;
        alert('Correct! 🎉');
    } else {
        alert(`Wrong! The correct answer was: ${currentQuizMovie.title}`);
    }
    
    document.getElementById('quiz-score-value').innerText = quizScore;
    document.getElementById('quiz-total').innerText = quizTotal;
    
    // Load next question
    setTimeout(() => {
        loadQuizQuestion();
    }, 500);
};

// Achievements System (Feature 34)
const achievements = [
    { id: 'first_watch', title: '🎬 First Watch', desc: 'Watch your first movie', condition: (stats) => stats.movies_watched >= 1 },
    { id: 'movie_buff', title: '🍿 Movie Buff', desc: 'Watch 10 movies', condition: (stats) => stats.movies_watched >= 10 },
    { id: 'cinephile', title: '🎭 Cinephile', desc: 'Watch 50 movies', condition: (stats) => stats.movies_watched >= 50 },
    { id: 'movie_master', title: '👑 Movie Master', desc: 'Watch 100 movies', condition: (stats) => stats.movies_watched >= 100 },
    { id: 'first_review', title: '✍️ First Review', desc: 'Write your first review', condition: (stats) => stats.reviews_written >= 1 },
    { id: 'critic', title: '⭐ Critic', desc: 'Write 10 reviews', condition: (stats) => stats.reviews_written >= 10 },
    { id: 'binge_watcher', title: '📺 Binge Watcher', desc: 'Watch 50 episodes', condition: (stats) => stats.episodes_watched >= 50 },
    { id: 'marathon', title: '🏃 Marathon', desc: 'Watch 24 hours of content', condition: (stats) => stats.hours_watched >= 24 },
    { id: 'collector', title: '📚 Collector', desc: 'Add 25 titles to your list', condition: (stats) => stats.list_adds >= 25 },
    { id: 'mega_fan', title: '🌟 Mega Fan', desc: 'Watch 200 movies', condition: (stats) => stats.movies_watched >= 200 }
];

async function checkAchievements() {
    if(!currentUser) return;
    
    const statsRef = doc(db, "users", currentUser.uid, "stats", "overall");
    const statsDoc = await getDoc(statsRef);
    
    if(!statsDoc.exists()) return;
    
    const stats = statsDoc.data();
    const unlockedRef = doc(db, "users", currentUser.uid, "achievements", "unlocked");
    const unlockedDoc = await getDoc(unlockedRef);
    const unlocked = unlockedDoc.exists() ? unlockedDoc.data().achievements || [] : [];
    
    for(const achievement of achievements) {
        if(!unlocked.includes(achievement.id) && achievement.condition(stats)) {
            // Unlock achievement
            await setDoc(unlockedRef, {
                achievements: [...unlocked, achievement.id]
            });
            
            // Show notification
            showAchievementNotification(achievement);
        }
    }
}

function showAchievementNotification(achievement) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        padding: 20px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        z-index: 10000;
        animation: slideIn 0.5s ease;
        max-width: 300px;
    `;
    
    notification.innerHTML = `
        <div style="font-size: 32px; text-align: center; margin-bottom: 8px;">${achievement.title.split(' ')[0]}</div>
        <div style="font-size: 16px; font-weight: 900; text-align: center; margin-bottom: 4px;">Achievement Unlocked!</div>
        <div style="font-size: 14px; font-weight: 800; text-align: center;">${achievement.title}</div>
        <div style="font-size: 12px; text-align: center; opacity: 0.8;">${achievement.desc}</div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.5s ease';
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}

window.openAchievementsModal = async () => {
    if(!currentUser) return alert("Login to view achievements");
    
    document.getElementById('achievements-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    const unlockedRef = doc(db, "users", currentUser.uid, "achievements", "unlocked");
    const unlockedDoc = await getDoc(unlockedRef);
    const unlocked = unlockedDoc.exists() ? unlockedDoc.data().achievements || [] : [];
    
    document.getElementById('achievements-grid').innerHTML = achievements.map(achievement => {
        const isUnlocked = unlocked.includes(achievement.id);
        
        return `
        <div style="background: var(--glass); border: 1px solid var(--glass-border); border-radius: 16px; padding: 24px; text-align: center; opacity: ${isUnlocked ? '1' : '0.4'};">
            <div style="font-size: 64px; margin-bottom: 16px;">${achievement.title.split(' ')[0]}</div>
            <div style="font-size: 16px; font-weight: 900; margin-bottom: 8px;">${achievement.title}</div>
            <div style="font-size: 12px; opacity: 0.7;">${achievement.desc}</div>
            ${isUnlocked ? '<div style="margin-top: 12px; color: #10b981; font-weight: 900; font-size: 12px;">✓ UNLOCKED</div>' : '<div style="margin-top: 12px; opacity: 0.5; font-size: 12px;">🔒 Locked</div>'}
        </div>`;
    }).join('');
};

window.closeAchievementsModal = () => {
    document.getElementById('achievements-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// Player Functions with BidSrc Pro
window.openPlayer = async (id, title, poster, rating = 0, releaseDate = '') => {
    activeID = id; 
    const year = releaseDate.split('-')[0] || '';
    activeItem = { 
        id, 
        title, 
        poster_path: poster, 
        mode, 
        vote_average: rating, 
        release_date: releaseDate 
    };
    
    document.getElementById('p-title').innerText = title;
    document.getElementById('p-rating').innerHTML = `★ ${rating ? rating.toFixed(1) : 'N/A'}`;
    document.getElementById('p-year').innerText = year;
    document.getElementById('player-overlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
    updateBtnStates();
    
    const res = await fetch(`https://api.themoviedb.org/3/${mode}/${id}?api_key=${KEY}&append_to_response=credits`).then(r => r.json());
    
    document.getElementById('p-desc').innerText = res.overview || 'No description available.';
    document.getElementById('p-cast').innerHTML = res.credits.cast.slice(0, 5).map(c => `
        <div class="flex items-center gap-4">
            ${c.profile_path ? `<img src="https://image.tmdb.org/t/p/w185${c.profile_path}" class="w-10 h-10 rounded-lg object-cover" alt="${c.name}">` : '<div class="w-10 h-10 rounded-lg bg-white/5"></div>'}
            <p class="text-[11px] font-black uppercase tracking-wider">${c.name}</p>
        </div>`).join('');
    
    document.getElementById('srv-menu').innerHTML = servers.map(sv => 
        `<button onclick="setSrv('${sv.id}','${sv.n}')" class="drop-item">${sv.n}</button>`
    ).join('');
    
    if(mode === 'tv') {
        document.getElementById('tv-controls').classList.remove('hidden');
        document.getElementById('s-menu').innerHTML = res.seasons
            .filter(sea => sea.season_number > 0)
            .map(sea => `<button onclick="setS(${sea.season_number})" class="drop-item">Season ${sea.season_number}</button>`)
            .join('');
        loadEpisodes();
    } else { 
        document.getElementById('tv-controls').classList.add('hidden'); 
        updPlayer(); 
    }
    
    // Save watch progress
    setTimeout(() => {
        saveWatchProgress(id, 300, 7200); // Simplified
    }, 60000); // After 1 minute
}

window.closePlayer = () => { 
    document.getElementById('player-overlay').style.display = 'none'; 
    document.getElementById('frame').src = ''; 
    document.body.style.overflow = 'auto'; 
}

window.setSrv = (id, n) => { 
    currentSrv = id; 
    document.getElementById('active-srv').innerText = n; 
    updPlayer(); 
    toggleDrop('srv-menu'); 
}

window.setS = (val) => { 
    s = val; 
    e = 1; 
    document.getElementById('s-val').innerText = val; 
    loadEpisodes(); 
    toggleDrop('s-menu'); 
}

window.setE = (val) => { 
    e = val; 
    document.getElementById('e-val').innerText = val; 
    updPlayer(); 
    toggleDrop('e-menu'); 
}

function updPlayer() {
    let src = '';
    if(mode === 'movie') {
        if(currentSrv === 'bidsrc') src = `https://bidsrc.pro/movie/${activeID}`;
        else if(currentSrv === 'cinemaos') src = `https://cinemaos.tech/player/${activeID}`;
        else if(currentSrv === 'vidsrcto') src = `https://vidsrc.to/embed/movie/${activeID}`;
        else if(currentSrv === 'vidsrcme') src = `https://vidsrc.me/embed/movie?tmdb=${activeID}`;
        else if(currentSrv === 'vidsrcicu') src = `https://vidsrc.icu/embed/movie/${activeID}`;
        else if(currentSrv === '2embed') src = `https://www.2embed.cc/embed/${activeID}`;
    } else {
        if(currentSrv === 'bidsrc') src = `https://bidsrc.pro/tv/${activeID}/${s}/${e}`;
        else if(currentSrv === 'cinemaos') src = `https://cinemaos.tech/player/${activeID}/${s}/${e}`;
        else if(currentSrv === 'vidsrcto') src = `https://vidsrc.to/embed/tv/${activeID}/${s}/${e}`;
        else if(currentSrv === 'vidsrcme') src = `https://vidsrc.me/embed/tv?tmdb=${activeID}&sea=${s}&epi=${e}`;
        else if(currentSrv === 'vidsrcicu') src = `https://vidsrc.icu/embed/tv/${activeID}/${s}/${e}`;
        else if(currentSrv === '2embed') src = `https://www.2embed.cc/embedtv/${activeID}&s=${s}&e=${e}`;
    }
    document.getElementById('frame').src = src;
}

async function loadEpisodes() {
    const d = await fetch(`https://api.themoviedb.org/3/tv/${activeID}/season/${s}?api_key=${KEY}`).then(r => r.json());
    document.getElementById('e-menu').innerHTML = d.episodes
        .map(ep => `<button onclick="setE(${ep.episode_number})" class="drop-item">Episode ${ep.episode_number}</button>`)
        .join('');
    updPlayer();
}

// Advanced Filtering
window.applyFilters = async () => {
    const yearFrom = document.getElementById('year-from').value;
    const yearTo = document.getElementById('year-to').value;
    const minRating = document.getElementById('min-rating').value;
    const sortBy = document.getElementById('sort-by').value;
    
    let url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}`;
    url += `&sort_by=${sortBy}`;
    
    if(yearFrom) url += `&primary_release_date.gte=${yearFrom}-01-01`;
    if(yearTo) url += `&primary_release_date.lte=${yearTo}-12-31`;
    if(minRating > 0) url += `&vote_average.gte=${minRating}`;
    
    const r = await fetch(url);
    const d = await r.json();
    
    renderGrid(d.results, 'grid');
    toggleDrop('filter-menu');
};

// Mode Switch
window.setMode = (m) => { 
    mode = m; 
    updateModeButtons();
    init(); 
}

function updateModeButtons() {
    const mBtn = document.getElementById('m-btn');
    const tBtn = document.getElementById('t-btn');
    
    if(mode === 'movie') {
        mBtn.classList.add('active');
        tBtn.classList.remove('active');
    } else {
        tBtn.classList.add('active');
        mBtn.classList.remove('active');
    }
}

// Genres
async function loadGenres() {
    const r = await fetch(`https://api.themoviedb.org/3/genre/${mode}/list?api_key=${KEY}`);
    const d = await r.json();
    document.getElementById('genre-menu').innerHTML = d.genres
        .map(g => `<button onclick="init('','${g.id}')" class="drop-item">${g.name}</button>`)
        .join('');
}

// UI Updates
function updateListUI() {
    const sec = document.getElementById('my-list-section');
    if(myList.length > 0) { 
        sec.classList.remove('hidden'); 
        renderGrid(myList, 'my-list-grid'); 
    } else { 
        sec.classList.add('hidden'); 
    }
}

function updateBtnStates() {
    if(!activeItem) return;
    const exists = myList.some(x => x.id === activeItem.id);
    
    const modalBtn = document.getElementById('modal-add-btn');
    const heroBtn = document.getElementById('hero-add');
    const detailsBtn = document.getElementById('details-add-btn');
    
    if(modalBtn) modalBtn.innerText = exists ? '✓ SAVED' : '+ SAVE';
    if(heroBtn) heroBtn.innerHTML = exists ? '<span>✓</span> Collected' : '<span>+</span> My List';
    if(detailsBtn) detailsBtn.innerHTML = exists ? '<span>✓</span> Saved' : '<span>+</span> My List';
}

// Theme Toggle
window.toggleTheme = () => {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    html.setAttribute('data-theme', newTheme);
    document.getElementById('theme-icon').innerText = newTheme === 'light' ? '☀️' : '🌙';
    
    localStorage.setItem('theme', newTheme);
};

// Load saved theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if(savedTheme === 'light') {
    document.getElementById('theme-icon').innerText = '☀️';
}

// Dropdown Toggle
window.toggleDrop = (id) => {
    const el = document.getElementById(id);
    const isShow = el.classList.contains('show');
    document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
    if(!isShow) el.classList.add('show');
};

// Close dropdowns on outside click
window.onclick = (e) => { 
    if (!e.target.closest('.relative') && !e.target.closest('#user-profile')) {
        document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show')); 
    }
};

// Close search overlay on ESC key
document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') {
        closeSearchOverlay();
        closeDetailsModal();
        closeActorModal();
        closeCalendarModal();
        closeRandomModal();
        closeQuizModal();
        closeAchievementsModal();
        closeStatsModal();
        closeShareModal();
    }
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from{ transform: translateX(400px); opacity: 0; }
to { transform: translateX(0); opacity: 1; }
}
@keyframes slideOut {
from { transform: translateX(0); opacity: 1; }
to { transform: translateX(400px); opacity: 0; }
}
.star-btn {
cursor: pointer;
transition: all 0.2s;
user-select: none;
}
.star-btn:hover {
transform: scale(1.2);
}
`;
document.head.appendChild(style);
// Initialize App
init();
