import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// TMDB API Key
const KEY = 'a45420333457411e78d5ad35d6c51a2d';

// Servers including BidSRC
const servers = [
    {id:'cinemaos', n:'Aura Primary'},
    {id:'vidsrcto', n:'Aura Mirror'},
    {id:'vidsrcme', n:'Aura Legacy'},
    {id:'vidsrcicu', n:'Aura Stream'},
    {id:'2embed', n:'Aura Cloud'},
    {id:'bidsrc', n:'Aura BidSRC'}  // Added BidSRC
];

// Global State
let mode = 'movie';
let activeID = null;
let currentSrv = 'cinemaos';
let s = 1;
let e = 1;
let activeItem = null;
let myList = [];
let currentUser = null;
let searchTimeout;

// Authentication
window.login = async () => { 
    try { await signInWithPopup(auth, provider); } 
    catch(error) { console.error(error); alert("Login Error: Make sure your domain is authorized in Firebase Console."); } 
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
    } else {
        loginBtn.classList.remove('hidden');
        userProfile.classList.add('hidden');
        myList = [];
        updateListUI();
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
    exists ? await deleteDoc(docRef) : await setDoc(docRef, activeItem);
};

// Search Overlay
window.openSearchOverlay = () => {
    document.getElementById('search-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('search-input').focus();
};
window.closeSearchOverlay = () => {
    document.getElementById('search-overlay').classList.remove('active');
    document.body.style.overflow = 'auto';
    document.getElementById('search-input').value = '';
    document.getElementById('search-results-container').innerHTML = `<div class="search-placeholder"><div class="search-placeholder-icon">🎬</div><p>Start typing to search...</p></div>`;
};

// Search Input Handler
document.getElementById('search-input').addEventListener('input', async (ev) => {
    clearTimeout(searchTimeout);
    const val = ev.target.value.trim();
    const resultsContainer = document.getElementById('search-results-container');
    
    if(val.length < 2) {
        resultsContainer.innerHTML = `<div class="search-placeholder"><div class="search-placeholder-icon">🎬</div><p>Start typing to search...</p></div>`;
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        const r = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${KEY}&query=${val}`);
        const d = await r.json();
        const results = d.results
            .filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path)
            .slice(0, 12);
        
        if(results.length === 0) {
            resultsContainer.innerHTML = `<div class="search-placeholder"><div class="search-placeholder-icon">😕</div><p>No results found for "${val}"</p></div>`;
        } else {
            resultsContainer.innerHTML = `<div class="search-results-grid">
                ${results.map(m => {
                    const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
                    const year = (m.release_date || m.first_air_date || '').split('-')[0] || '';
                    const mediaType = m.media_type === 'movie' ? 'Movie' : 'Series';
                    const title = (m.title || m.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    return `<div class="search-result-card" onclick="selectSearchResult(${m.id}, '${m.media_type}', '${title}', '${m.poster_path}', ${m.vote_average || 0}, '${m.release_date || m.first_air_date || ''}')">
                        <div class="search-result-poster"><img src="https://image.tmdb.org/t/p/w500${m.poster_path}" alt="${m.title || m.name}"></div>
                        <div class="search-result-info"><h4 class="search-result-title">${m.title || m.name}</h4>
                            <div class="search-result-meta">
                                <span class="search-result-rating">★ ${rating}</span>
                                <span class="search-result-year">${year}</span>
                                <span class="search-result-type">${mediaType}</span>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        }
    }, 300);
});

window.selectSearchResult = (id, mediaType, title, poster, rating, releaseDate) => {
    const oldMode = mode;
    mode = mediaType;
    if(oldMode !== mode) updateModeButtons();
    closeSearchOverlay();
    openPlayer(id, title, poster, rating, releaseDate);
};

// Initialize App
async function init(q='', g='') {
    let url = `https://api.themoviedb.org/3/trending/${mode}/week?api_key=${KEY}`;
    if(q) url = `https://api.themoviedb.org/3/search/${mode}?api_key=${KEY}&query=${q}`;
    if(g) url = `https://api.themoviedb.org/3/discover/${mode}?api_key=${KEY}&with_genres=${g}`;
    const r = await fetch(url);
    const d = await r.json();
    if(!q && !g && d.results[0]) setupHero(d.results[0]);
    renderGrid(d.results, 'grid');
    loadGenres();
}

// Hero
async function setupHero(m) {
    document.getElementById('hero-bg').style.backgroundImage = `url(https://image.tmdb.org/t/p/original${m.backdrop_path})`;
    document.getElementById('hero-title').innerText = m.title || m.name;
    document.getElementById('hero-rating').innerHTML = `★ ${m.vote_average ? m.vote_average.toFixed(1) : 'N/A'}`;
    document.getElementById('hero-year').innerText = (m.release_date || m.first_air_date || '').split('-')[0];
    const details = await fetch(`https://api.themoviedb.org/3/${mode}/${m.id}?api_key=${KEY}`).then(r=>r.json());
    document.getElementById('hero-description').innerText = details.overview || 'No description available.';
    activeItem = {id: m.id, title: m.title || m.name, poster_path: m.poster_path, mode, vote_average: m.vote_average, release_date: m.release_date, first_air_date: m.first_air_date};
    document.getElementById('hero-play').onclick = () => openPlayer(m.id, m.title || m.name, m.poster_path, m.vote_average, m.release_date || m.first_air_date);
    document.getElementById('hero-add').onclick = toggleMyList;
    document.getElementById('hero-info').onclick = () => openPlayer(m.id, m.title || m.name, m.poster_path, m.vote_average, m.release_date || m.first_air_date);
    updateBtnStates();
}

// Render Grid
function renderGrid(list, target) {
    document.getElementById(target).innerHTML = list.map(m => {
        if(!m.poster_path) return '';
        const rating = m.vote_average ? m.vote_average.toFixed(1) : 'N/A';
        const year = (m.release_date || m.first_air_date || '').split('-')[0] || '';
        const title = (m.title || m.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `<div class="movie-card" onclick="openPlayer(${m.id}, '${title}', '${m.poster_path}', ${m.vote_average || 0}, '${m.release_date || m.first_air_date || ''}')">
            <img src="https://image.tmdb.org/t/p/w500${m.poster_path}" class="w-full" alt="${m.title || m.name}">
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

// Player
window.openPlayer = async (id, title, poster, rating=0, releaseDate='') => {
    activeID=id; activeItem={id, title, poster_path: poster, mode, vote_average: rating, release_date: releaseDate};
    document.getElementById('p-title').innerText=title;
    document.getElementById('p-rating').innerHTML=`★ ${rating ? rating.toFixed(1) : 'N/A'}`;
    document.getElementById('p-year').innerText=releaseDate.split('-')[0]||'';
    document.getElementById('player-overlay').style.display='block'; document.body.style.overflow='hidden';
    updateBtnStates();
    const res = await fetch(`https://api.themoviedb.org/3/${mode}/${id}?api_key=${KEY}&append_to_response=credits`).then(r=>r.json());
    document.getElementById('p-desc').innerText=res.overview||'No description available.';
    document.getElementById('p-cast').innerHTML=res.credits.cast.slice(0,5).map(c=>`
        <div class="flex items-center gap-4">${c.profile_path?`<img src="https://image.tmdb.org/t/p/w185${c.profile_path}" class="w-10 h-10 rounded-lg object-cover" alt="${c.name}">`:'<div class="w-10 h-10 rounded-lg bg-white/5"></div>'}<p class="text-[11px] font-black uppercase tracking-wider">${c.name}</p></div>`).join('');
    document.getElementById('srv-menu').innerHTML=servers.map(sv=>`<button onclick="setSrv('${sv.id}','${sv.n}')" class="drop-item">${sv.n}</button>`).join('');
    if(mode==='tv'){document.getElementById('tv-controls').classList.remove('hidden');document.getElementById('s-menu').innerHTML=res.seasons.filter(sea=>sea.season_number>0).map(sea=>`<button onclick="setS(${sea.season_number})" class="drop-item">Season ${sea.season_number}</button>`).join('');loadEpisodes();}
    else{document.getElementById('tv-controls').classList.add('hidden');updPlayer();}
}
window.closePlayer=()=>{document.getElementById('player-overlay').style.display='none';document.getElementById('frame').src='';document.body.style.overflow='auto';}

// Player Controls
window.setSrv=(id,n)=>{currentSrv=id;document.getElementById('active-srv').innerText=n;updPlayer();toggleDrop('srv-menu');}
window.setS=(val)=>{s=val;e=1;document.getElementById('s-val').innerText=val;loadEpisodes();toggleDrop('s-menu');}
window.setE=(val)=>{e=val;document.getElementById('e-val').innerText=val;updPlayer();toggleDrop('e-menu');}

function updPlayer(){
    let src='';
    if(mode==='movie'){
        if(currentSrv==='cinemaos') src=`https://cinemaos.tech/player/${activeID}`;
        else if(currentSrv==='vidsrcto') src=`https://vidsrc.to/embed/movie/${activeID}`;
        else if(currentSrv==='vidsrcme') src=`https://vidsrc.me/embed/movie?tmdb=${activeID}`;
        else if(currentSrv==='vidsrcicu') src=`https://vidsrc.icu/embed/movie/${activeID}`;
        else if(currentSrv==='2embed') src=`https://www.2embed.cc/embed/${activeID}`;
        else if(currentSrv==='bidsrc') src=`https://bidsrc.to/embed/movie/${activeID}`;
    }else{
        if(currentSrv==='cinemaos') src=`https://cinemaos.tech/player/${activeID}/${s}/${e}`;
        else if(currentSrv==='vidsrcto') src=`https://vidsrc.to/embed/tv/${activeID}/${s}/${e}`;
        else if(currentSrv==='vidsrcme') src=`https://vidsrc.me/embed/tv?tmdb=${activeID}&sea=${s}&epi=${e}`;
        else if(currentSrv==='vidsrcicu') src=`https://vidsrc.icu/embed/tv/${activeID}/${s}/${e}`;
        else if(currentSrv==='2embed') src=`https://www.2embed.cc/embedtv/${activeID}&s=${s}&e=${e}`;
        else if(currentSrv==='bidsrc') src=`https://bidsrc.to/embed/tv/${activeID}/${s}/${e}`;
    }
    document.getElementById('frame').src=src;
}

async function loadEpisodes(){
    const d = await fetch(`https://api.themoviedb.org/3/tv/${activeID}/season/${s}?api_key=${KEY}`).then(r=>r.json());
    document.getElementById('e-menu').innerHTML=d.episodes.map(ep=>`<button onclick="setE(${ep.episode_number})" class="drop-item">Episode ${ep.episode_number}</button>`).join('');
    updPlayer();
}

// Mode
window.setMode=(m)=>{mode=m;updateModeButtons();init();}
function updateModeButtons(){const mBtn=document.getElementById('m-btn');const tBtn=document.getElementById('t-btn');if(mode==='movie'){mBtn.classList.add('active');tBtn.classList.remove('active');}else{tBtn.classList.add('active');mBtn.classList.remove('active');}}

// Genres
async function loadGenres(){
    const r = await fetch(`https://api.themoviedb.org/3/genre/${mode}/list?api_key=${KEY}`);
    const d = await r.json();
    document.getElementById('genre-menu').innerHTML=d.genres.map(g=>`<button onclick="init('','${g.id}')" class="drop-item">${g.name}</button>`).join('');
}

// UI Updates
function updateListUI(){const sec=document.getElementById('my-list-section');if(myList.length>0){sec.classList.remove('hidden');renderGrid(myList,'my-list-grid');}else{sec.classList.add('hidden');}}
function updateBtnStates(){if(!activeItem)return;const exists=myList.some(x=>x.id===activeItem.id);const modalBtn=document.getElementById('modal-add-btn');const heroBtn=document.getElementById('hero-add');if(modalBtn)modalBtn.innerText=exists?'✓ SAVED':'+ SAVE';if(heroBtn)heroBtn.innerHTML=exists?'<span>✓</span> Collected':'<span>+</span> My List';}

// Dropdown
window.toggleDrop=(id)=>{const el=document.getElementById(id);const isShow=el.classList.contains('show');document.querySelectorAll('.dropdown-menu').forEach(d=>d.classList.remove('show'));if(!isShow)el.classList.add('show');}
window.onclick=(e)=>{if(!e.target.closest('.relative')&&!e.target.closest('#user-profile')){document.querySelectorAll('.dropdown-menu').forEach(d=>d.classList.remove('show'));}}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSearchOverlay();});

// Initialize
init();
