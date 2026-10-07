/* =========================================================
   SOL'S COLLECTION
   FULL VERSION
   - Views
   - Votes
   - Sorting
   - Covers
   - Supabase Authentication
   - Secure Chapter Access
   - PayMongo Payment
   - Reading Progress
   - Per-book price (books.price) + "Proceed to Payment"
   - Full-book purchase unlocks all chapters
   - No duplicate "Chapter 1 Chapter 1" in sidebar
========================================================= */

const SUPABASE_URL = "https://whxtkvavyisbvisdemhn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dtX1ejuMrmJrBFmLCxnksg_8qpuxMzQ";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

/* =========================================================
   GLOBAL STATE
========================================================= */

let books = [];
let currentBook = null;
let currentChapters = [];
let currentChapterIndex = 0;
let currentChapter = null;
let currentUser = null;
let pendingChapter = null;
let viewTimer = null;
let currentSort = "latest";
let currentQuery = "";
let currentGenre = "";

/* Reading position (Continue Reading) */
let continueState = null;          // what the Continue Reading card currently shows
let pendingRestore = null;         // position to jump to once the chapter text is on screen
let positionSaveTimer = null;
let positionBurstStart = 0;
let positionColumns = true;        // flips to false if the DB hasn't got the new columns yet
let progressQueue = Promise.resolve();

/* Chapter unlock state (read-only, for the lock/unlock icons) */
let fullBookUnlocked = false;
let unlockedChapterIds = new Set();

/* Default full-book price if a book has no price set */
const DEFAULT_BOOK_PRICE = 150;

/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

/* Minimal outline icons (Lucide "eye" and "sun"), 16x16 */
const ICON_EYE = '<svg class="stat-icon eye" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_SUN = '<svg class="stat-icon sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

/* Returns the full-book price for a book (falls back to 150) */
function getBookPrice(book) {
    const price = Number(book?.price);
    return Number.isFinite(price) && price > 0 ? price : DEFAULT_BOOK_PRICE;
}

/* True when a title is empty or just repeats "Chapter N" */
function isDefaultChapterTitle(title, chapterNumber) {
    const t = (title || "").trim().toLowerCase();
    return !t || t === `chapter ${chapterNumber}`;
}

/* =========================================================
   INITIALIZE
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

    handlePaymentReturn();

    setupTheme();
    setupNavigation();
    setupModals();
    setupAuthentication();
    setupReaderControls();
    setupReaderExtras();
    setupGenreButtons();
    setupSortButtons();
    setupBookSearch();
    setupReadingPositionTracking();

    await checkUser();
    await loadBooks();

    if (paymentReturn) await verifyPaymentAndUnlock(paymentReturn);
});

/* =========================================================
   THEME
========================================================= */

function setupTheme() {

    const themeToggle = $("themeToggle");

    if (!themeToggle) return;

    const savedTheme = localStorage.getItem("solsTheme");

    if (savedTheme === "dark") {
        document.body.classList.add("dark-mode");
        themeToggle.textContent = "☀";
    }

    themeToggle.addEventListener("click", () => {

        document.body.classList.toggle("dark-mode");

        const isDark = document.body.classList.contains("dark-mode");

        localStorage.setItem("solsTheme", isDark ? "dark" : "light");

        themeToggle.textContent = isDark ? "☀" : "☾";
    });
}

/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

    const loginButton = $("loginNavButton");
    const signupButton = $("signupNavButton");
    const logoutButton = $("logoutButton");

    const mobileMenuButton = $("mobileMenuButton");
    const mobileMenu = $("mobileMenu");

    const mobileLoginButton = $("mobileLoginButton");
    const mobileSignupButton = $("mobileSignupButton");
    const mobileLogoutButton = $("mobileLogoutButton");

    if (loginButton) {
        loginButton.addEventListener("click", () => openModal("loginModal"));
    }

    if (signupButton) {
        signupButton.addEventListener("click", () => openModal("signupModal"));
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", logout);
    }

    if (mobileMenuButton && mobileMenu) {
        mobileMenuButton.addEventListener(
            "click",
            () => mobileMenu.classList.toggle("active")
        );
    }

    if (mobileLoginButton) {
        mobileLoginButton.addEventListener("click", () => {
            closeMobileMenu();
            openModal("loginModal");
        });
    }

    if (mobileSignupButton) {
        mobileSignupButton.addEventListener("click", () => {
            closeMobileMenu();
            openModal("signupModal");
        });
    }

    if (mobileLogoutButton) {
        mobileLogoutButton.addEventListener("click", logout);
    }

    document.querySelectorAll(".mobile-menu a").forEach(link => {
        link.addEventListener("click", closeMobileMenu);
    });

    const heroContinueButton = $("heroContinueButton");

    if (heroContinueButton) {
        heroContinueButton.addEventListener("click", continueReading);
    }

    const continueButton = $("continueButton");

    if (continueButton) {
        continueButton.addEventListener("click", continueReading);
    }
}

function closeMobileMenu() {

    const mobileMenu = $("mobileMenu");

    if (mobileMenu) {
        mobileMenu.classList.remove("active");
    }
}

/* =========================================================
   MODALS
========================================================= */

function setupModals() {

    document.querySelectorAll("[data-close]").forEach(button => {
        button.addEventListener(
            "click",
            () => closeModal(button.dataset.close)
        );
    });

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", () => {

            const modal = overlay.closest(".modal");

            if (modal) {
                closeModal(modal.id);
            }
        });
    });

    const startReadingButton = $("startReadingButton");

    if (startReadingButton) {
        startReadingButton.addEventListener("click", () => {

            if (!currentBook) return;

            closeModal("bookModal");

            openReader(currentBook.id, 1);
        });
    }

    const paymentButton = $("demoPaymentButton");

    if (paymentButton) {
        paymentButton.addEventListener("click", startRealPayment);
    }
}

function openModal(id) {

    const modal = $(id);

    if (!modal) return;

    modal.classList.add("active");

    document.body.classList.add("modal-open");
}

function closeModal(id) {

    const modal = $(id);

    if (!modal) return;

    modal.classList.remove("active");

    document.body.classList.remove("modal-open");
}

/* =========================================================
   AUTHENTICATION
========================================================= */

async function checkUser() {

    try {

        const { data, error } = await supabaseClient.auth.getUser();

        if (error) {

            console.error("Auth error:", error);

            currentUser = null;

        } else {

            currentUser = data.user || null;
        }

        updateAuthUI();

    } catch (error) {

        console.error("Unable to check user:", error);

        currentUser = null;

        updateAuthUI();
    }

    supabaseClient.auth.onAuthStateChange(
        async (_event, session) => {

            currentUser = session?.user || null;

            updateAuthUI();

            if (window.SolBookmarks) window.SolBookmarks.onAuth(currentUser);

            if (currentBook) {
                refreshUnlockedState();
            }

            await loadContinueReading();
        }
    );
}

function updateAuthUI() {

    const loginButton = $("loginNavButton");
    const signupButton = $("signupNavButton");
    const logoutButton = $("logoutButton");

    const mobileLoginButton = $("mobileLoginButton");
    const mobileSignupButton = $("mobileSignupButton");
    const mobileLogoutButton = $("mobileLogoutButton");

    if (currentUser) {

        loginButton?.classList.add("hidden");
        signupButton?.classList.add("hidden");
        logoutButton?.classList.remove("hidden");

        mobileLoginButton?.classList.add("hidden");
        mobileSignupButton?.classList.add("hidden");
        mobileLogoutButton?.classList.remove("hidden");

    } else {

        loginButton?.classList.remove("hidden");
        signupButton?.classList.remove("hidden");
        logoutButton?.classList.add("hidden");

        mobileLoginButton?.classList.remove("hidden");
        mobileSignupButton?.classList.remove("hidden");
        mobileLogoutButton?.classList.add("hidden");
    }
}

function setupAuthentication() {

    const loginForm = $("loginForm");
    const signupForm = $("signupForm");

    const switchToSignup = $("switchToSignup");
    const switchToLogin = $("switchToLogin");

    if (loginForm) {
        loginForm.addEventListener("submit", login);
    }

    if (signupForm) {
        signupForm.addEventListener("submit", signup);
    }

    if (switchToSignup) {
        switchToSignup.addEventListener("click", () => {
            closeModal("loginModal");
            openModal("signupModal");
        });
    }

    if (switchToLogin) {
        switchToLogin.addEventListener("click", () => {
            closeModal("signupModal");
            openModal("loginModal");
        });
    }
}

async function login(event) {

    event.preventDefault();

    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    try {

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {

            solToast("Login failed: " + error.message);

            return;
        }

        currentUser = data.user;

        updateAuthUI();

        closeModal("loginModal");

        $("loginForm").reset();

        solToast("Welcome back!");

        await loadContinueReading();

        /*
         * If the user was trying to purchase before logging in,
         * continue the purchase flow.
         */

        if (pendingChapter) {

            const chapter = pendingChapter;

            if (
                currentChapters.length > 0 &&
                currentChapters.some(c => c.id === chapter.id)
            ) {

                const index = currentChapters.findIndex(
                    c => c.id === chapter.id
                );

                if (index !== -1) {
                    await openChapter(index);
                }
            }
        }

    } catch (error) {

        console.error(error);

        solToast("Something went wrong while logging in.");
    }
}

async function signup(event) {

    event.preventDefault();

    const name = $("signupName").value.trim();
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;

    try {

        const { data, error } = await supabaseClient.auth.signUp({

            email,
            password,

            options: {
                /* confirmation email sends people back to THIS site, not Supabase's default URL */
                emailRedirectTo: window.location.origin,
                data: {
                    display_name: name
                }
            }
        });

        if (error) {

            solToast("Sign up failed: " + error.message);

            return;
        }

        $("signupForm").reset();

        closeModal("signupModal");

        if (data.session) {

            currentUser = data.user;

            updateAuthUI();

            solToast("Account created successfully!");

        } else {

            solToast("Account created! Please check your email to confirm your account.");
        }

    } catch (error) {

        console.error(error);

        solToast("Something went wrong while creating your account.");
    }
}

async function logout() {

    const { error } = await supabaseClient.auth.signOut();

    if (error) {

        solToast("Logout failed: " + error.message);

        return;
    }

    currentUser = null;

    pendingChapter = null;

    updateAuthUI();

    closeReader();

    solToast("You have been logged out.");
}

/* =========================================================
   LOAD BOOKS
========================================================= */

async function loadBooks() {

    const loading = $("booksLoading");
    const empty = $("booksEmpty");

    if (loading) {
        loading.classList.remove("hidden");
    }

    if (empty) {
        empty.classList.add("hidden");
    }

    try {

        const { data, error } = await supabaseClient
            .from("books")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {

            console.error("Books error:", error);

            if (loading) {
                loading.textContent = "Unable to load books.";
            }

            return;
        }

        books = data || [];

        if (loading) {
            loading.classList.add("hidden");
        }

        if (!books.length) {

            if (empty) {
                empty.classList.remove("hidden");
            }

            return;
        }

        applySort(currentSort);

        await loadContinueReading();

    } catch (error) {

        console.error("Load books error:", error);

        if (loading) {
            loading.textContent = "Unable to load books.";
        }
    }
}

/* =========================================================
   SORTING
========================================================= */

function setupSortButtons() {

    document.querySelectorAll(".sort-button").forEach(btn => {

        btn.addEventListener("click", () => {

            document
                .querySelectorAll(".sort-button")
                .forEach(b => b.classList.remove("active"));

            btn.classList.add("active");

            currentSort = btn.dataset.sort;

            applySort(currentSort);
        });
    });
}

function applySort(type) {

    let sorted = [...books];

    if (type === "popular") {

        sorted.sort(
            (a, b) => (Number(b.views) || 0) - (Number(a.views) || 0)
        );

    } else if (type === "voted") {

        sorted.sort(
            (a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0)
        );

    } else {

        sorted.sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
    }

    // Search + genre filters stack on top of whichever sort is active,
    // so views/votes updates never wipe out what the reader is looking at.
    renderBooks(sorted.filter(matchesFilters));
}

/* True when a book passes the current genre filter AND search query */
function matchesFilters(book) {

    if (currentGenre) {
        const bookGenre = (book.genre || "").toLowerCase();
        if (!bookGenre.includes(currentGenre.toLowerCase())) return false;
    }

    if (currentQuery) {
        const haystack = [
            book.title,
            book.author,
            book.genre,
            book.description
        ].join(" ").toLowerCase();

        // every word typed must appear somewhere ("dark romance", "ladyysol love")
        return currentQuery
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .every(word => haystack.includes(word));
    }

    return true;
}

function renderBooks(list = books) {

    const booksGrid = $("booksGrid");

    if (!booksGrid) return;

    booksGrid.innerHTML = "";

    if (!list.length) {

        const message = (currentGenre && !currentQuery)
            ? `No ${escapeHtml(currentGenre)} stories found yet.`
            : "No stories found.";

        booksGrid.innerHTML =
            `<div class="empty-message">${message}</div>`;

        return;
    }

    list.forEach(book => {

        const card = document.createElement("article");
        card.className = "book-card";

        const genre = book.genre || "Romance";
        const chapters = book.total_chapters || 0;

        const views = (Number(book.views) || 0).toLocaleString();
        const votes = (Number(book.votes) || 0).toLocaleString();

        const coverHtml = book.cover_url
            ? `
                <img
                    src="${escapeHtml(book.cover_url)}"
                    alt="${escapeHtml(book.title)}"
                    loading="lazy"
                >
              `
            : `
                <div class="cover-fallback">
                    <span>SC</span>
                </div>
              `;

        card.innerHTML = `
            <div class="book-cover lores-cover">
                ${coverHtml}
            </div>

            <div class="book-information">
                <p class="book-category">
                    ${escapeHtml(genre)}
                </p>

                <h3>
                    ${escapeHtml(book.title)}
                </h3>

                <p class="book-author">
                    By ${escapeHtml(book.author || "Sol")}
                </p>

                <p class="book-description">
                    ${escapeHtml(
                        book.description ||
                        "Enter the story and discover what happens next."
                    )}
                </p>

                <div class="book-stats">
                    <span title="Views">${ICON_EYE}${views}</span>
                    <span title="Votes">${ICON_SUN}${votes}</span>
                </div>

                <div class="book-bottom">
                    <span class="chapter-count">
                        ${chapters} Chapters
                    </span>

                    <button class="read-button" type="button">
                        View Book
                    </button>
                </div>
            </div>
        `;

        // Make the ENTIRE card clickable
        card.addEventListener("click", () => showBook(book.id));

        // Still keep the button working (and stop double trigger)
        const readButton = card.querySelector(".read-button");
        if (readButton) {
            readButton.addEventListener("click", (e) => {
                e.stopPropagation();
                showBook(book.id);
            });
        }

        booksGrid.appendChild(card);
    });
}

/* =========================================================
   SHOW BOOK
========================================================= */

async function showBook(bookId) {

    const book = books.find(item => item.id === bookId);

    if (!book) return;

    currentBook = book;

    $("modalBookTitle").textContent = book.title;

    $("modalBookAuthor").textContent = `By ${book.author || "Sol"}`;

    $("modalBookDescription").textContent =
        book.description || "No description available.";

    resetSynopsis();

    /* Bookmarks panel (js/bookmarks.js) */
    if (window.SolBookmarks) window.SolBookmarks.renderModal(book);

    $("modalBookGenre").textContent = book.genre || "Romance";

    /*
     * Calculate free chapter count from the database.
     */

    let freeChapterCount = 5;

    try {

        const { data, error } = await supabaseClient.rpc(
            "get_book_chapter_metadata",
            { p_book_id: book.id }
        );

        if (!error && data) {

            freeChapterCount = data.filter(
                chapter => chapter.is_free === true
            ).length;
        }

    } catch (error) {

        console.warn("Unable to load free chapter count:", error);
    }

    if ($("modalFreeChapters")) {
        $("modalFreeChapters").textContent = freeChapterCount;
    }

    /*
     * Show this book's own full-access price.
     */

    const priceEl = $("modalBookPrice");

    if (priceEl) {
        priceEl.textContent = "₱" + getBookPrice(book);
    }

    const views = (Number(book.views) || 0).toLocaleString();

    const votes = (Number(book.votes) || 0).toLocaleString();

    const alreadyVoted =
        !!currentUser && localStorage.getItem(votedKey(book.id)) === "true";

    let statsContainer = document.getElementById("modalStats");

    if (!statsContainer) {

        statsContainer = document.createElement("div");

        statsContainer.id = "modalStats";

        statsContainer.className = "modal-stats";

        ($("modalBookAuthor") || $("modalBookDescription")).after(statsContainer);
    }

    statsContainer.innerHTML = `

        <span class="modal-stat" title="Views">
            ${ICON_EYE}
            <strong>${views}</strong>
        </span>

        <span class="modal-stat" title="Votes">
            ${ICON_SUN}
            <strong id="modalVoteCount">${votes}</strong>
        </span>

        <button
            id="voteButton"
            class="vote-button ${alreadyVoted ? "voted" : ""}"
            type="button"
            ${alreadyVoted ? "disabled" : ""}
        >
            ${ICON_SUN}
            <span id="voteButtonText">${alreadyVoted ? "Voted" : "Vote"}</span>
        </button>
    `;

    const voteBtn = $("voteButton");

    if (voteBtn && !alreadyVoted) {
        voteBtn.onclick = () => voteBook(book.id);
    }

    if (!alreadyVoted) syncVoteState(book.id);

    const cover = $("modalBookCover");

    if (cover) {

        cover.className = "modal-book-cover lores-cover";

        if (book.cover_url) {

            cover.innerHTML = `

                <img
                    src="${escapeHtml(book.cover_url)}"
                    alt="${escapeHtml(book.title)}"
                >

            `;

        } else {

            cover.innerHTML = `

                <div class="cover-fallback">
                    <span>SC</span>
                </div>

            `;
        }
    }

    openModal("bookModal");

    refreshSynopsisToggle();
}

/* =========================================================
   SYNOPSIS: 3-line clamp + Read More toggle
========================================================= */

function resetSynopsis() {

    const desc = $("modalBookDescription");
    const toggle = $("synopsisToggle");

    if (desc) desc.classList.add("clamped");

    if (toggle) {
        toggle.classList.add("hidden");
        toggle.textContent = "Read More";
        toggle.setAttribute("aria-expanded", "false");
    }
}

function refreshSynopsisToggle() {

    const desc = $("modalBookDescription");
    const toggle = $("synopsisToggle");

    if (!desc || !toggle) return;

    /* Wait a frame so the modal is visible and can be measured */
    requestAnimationFrame(() => {

        const overflowing = desc.scrollHeight > desc.clientHeight + 1;

        toggle.classList.toggle("hidden", !overflowing);

        toggle.onclick = () => {

            const expanded = desc.classList.toggle("clamped") === false;

            toggle.textContent = expanded ? "Show Less" : "Read More";

            toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        };
    });
}

/* =========================================================
   READER
========================================================= */

async function openReader(bookId, chapterNumber = 1) {

    const book = books.find(item => item.id === bookId);

    if (!book) return;

    currentBook = book;

    currentChapterIndex = Math.max(0, Number(chapterNumber) - 1);

    const reader = $("readerSection");

    if (reader) {

        reader.classList.remove("hidden");

        reader.classList.add("active");
    }

    document.body.classList.add("reader-open");

    if ($("readerBookTitle")) {
        $("readerBookTitle").textContent = book.title;
    }

    if ($("sidebarBookTitle")) {
        $("sidebarBookTitle").textContent = book.title;
    }

    updateReaderStats(book);

    await loadChapterList();

    /*
     * Make sure the requested chapter exists.
     */

    if (currentChapterIndex >= currentChapters.length) {
        currentChapterIndex = 0;
    }

    await openChapter(currentChapterIndex);

    if (reader) {
        reader.scrollIntoView({ behavior: "smooth" });
    }
}

function updateReaderStats(book) {

    const viewsEl = $("readerViews");
    const votesEl = $("readerVotes");

    if (viewsEl) {
        viewsEl.innerHTML =
            `${ICON_EYE}<span>${(Number(book.views) || 0).toLocaleString()}</span>`;
    }

    if (votesEl) {
        votesEl.innerHTML =
            `${ICON_SUN}<span>${(Number(book.votes) || 0).toLocaleString()}</span>`;
    }
}

function closeReader() {

    flushReadingPosition();

    if (viewTimer) {

        clearTimeout(viewTimer);

        viewTimer = null;
    }

    const reader = $("readerSection");

    if (reader) {

        reader.classList.add("hidden");

        reader.classList.remove("active");
    }

    document.body.classList.remove("reader-open");

    currentBook = null;
    currentChapters = [];
    currentChapter = null;
    currentChapterIndex = 0;
}

/* =========================================================
   READER CONTROLS
========================================================= */

function setupReaderControls() {

    const closeButton = $("closeReaderButton");
    const previousButton = $("previousChapter");
    const nextButton = $("nextChapter");

    if (closeButton) {
        closeButton.addEventListener("click", closeReader);
    }

    if (previousButton) {
        previousButton.addEventListener("click", async () => {

            if (currentChapterIndex > 0) {
                await openChapter(currentChapterIndex - 1);
            }
        });
    }

    if (nextButton) {
        nextButton.addEventListener("click", async () => {

            if (currentChapterIndex < currentChapters.length - 1) {
                await openChapter(currentChapterIndex + 1);
            }
        });
    }
}

/* =========================================================
   LOAD CHAPTER LIST
   Uses metadata RPC.
   Does NOT expose chapter content.
========================================================= */

async function loadChapterList() {

    if (!currentBook) return;

    try {

        const { data, error } = await supabaseClient.rpc(
            "get_book_chapter_metadata",
            { p_book_id: currentBook.id }
        );

        if (error) {

            console.error("Failed to load chapter list:", error);

            solToast("Failed to load chapters.");

            return;
        }

        currentChapters = data || [];

        const chapterList = $("chapterList");

        if (!chapterList) {

            console.error("chapterList element not found.");

            return;
        }

        chapterList.innerHTML = "";

        currentChapters.forEach((chapter, index) => {

            const item = document.createElement("button");

            item.type = "button";

            item.className = "chapter-item";

            if (index === currentChapterIndex) {
                item.classList.add("active");
            }

            const isFree = chapter.is_free === true;

            const accessLabel = isFree
                ? "FREE"
                : (isChapterMarkedUnlocked(chapter) ? "🔓 UNLOCKED" : "🔒 LOCKED");

            /* Hide the title when it only repeats "Chapter N" */
            const rawTitle = (chapter.title || "").trim();

            const hideTitle = isDefaultChapterTitle(
                rawTitle,
                chapter.chapter_number
            );

            item.innerHTML = `

                <span class="chapter-number">
                    Chapter ${chapter.chapter_number}
                </span>

                ${
                    hideTitle
                        ? `<span class="chapter-title"></span>`
                        : `<span class="chapter-title">${escapeHtml(rawTitle)}</span>`
                }

                <span class="chapter-price ${isFree ? "free" : "paid"}${!isFree && isChapterMarkedUnlocked(chapter) ? " unlocked" : ""}">
                    ${accessLabel}
                </span>

            `;

            item.addEventListener("click", async () => {

                const clickedIndex = currentChapters.findIndex(
                    c => c.id === chapter.id
                );

                if (clickedIndex !== -1) {
                    await openChapter(clickedIndex);
                }
            });

            chapterList.appendChild(item);
        });

        updateNavigationButtons();

        /* Show 🔓 on chapters this reader has already paid for */
        refreshUnlockedState();

    } catch (error) {

        console.error("Chapter list error:", error);

        solToast("Something went wrong while loading chapters.");
    }
}

/* =========================================================
   LOCK / UNLOCK ICONS
   Frontend display only. Reads the same public.purchases
   table the app already uses; real access is still decided
   by the get_chapter_for_reader RPC.
========================================================= */

function isChapterMarkedUnlocked(chapter) {

    if (!chapter) return false;

    return fullBookUnlocked || unlockedChapterIds.has(chapter.id);
}

function applyLockBadges() {

    document.querySelectorAll(".chapter-item").forEach((item, index) => {

        const chapter = currentChapters[index];

        if (!chapter) return;

        const isFree =
            chapter.is_free === true ||
            chapter.is_free === "true" ||
            chapter.is_free === 1;

        if (isFree) return;

        const badge = item.querySelector(".chapter-price");

        if (!badge) return;

        const unlocked = isChapterMarkedUnlocked(chapter);

        badge.textContent = unlocked ? "🔓 UNLOCKED" : "🔒 LOCKED";

        badge.classList.toggle("unlocked", unlocked);
    });
}

async function refreshUnlockedState() {

    fullBookUnlocked = false;
    unlockedChapterIds = new Set();

    if (currentUser && currentBook) {

        try {

            const { data, error } = await supabaseClient
                .from("purchases")
                .select("chapter_id, book_id, purchase_type")
                .eq("user_id", currentUser.id)
                .eq("payment_status", "paid");

            if (error) {

                console.error("Unlock state check failed:", error);

            } else {

                (data || []).forEach(row => {

                    if (
                        row.purchase_type === "book" &&
                        row.book_id === currentBook.id
                    ) {
                        fullBookUnlocked = true;
                    } else if (row.chapter_id) {
                        unlockedChapterIds.add(row.chapter_id);
                    }
                });
            }

        } catch (error) {

            console.error("Unlock state error:", error);
        }
    }

    applyLockBadges();
}

/* Scroll the reader back to the top (used when changing chapter) */
function scrollReaderToTop() {

    const reader = document.querySelector(".story-reader");

    if (reader) {
        reader.scrollTop = 0;
    }

    window.scrollTo(0, 0);
}

/* =========================================================
   OPEN CHAPTER
========================================================= */

async function openChapter(index) {

    if (index < 0 || index >= currentChapters.length) {
        return;
    }

    currentChapterIndex = index;

    const chapter = currentChapters[index];

    currentChapter = chapter;

    const isFree =
        chapter.is_free === true ||
        chapter.is_free === "true" ||
        chapter.is_free === 1;

    /* =====================================================
       FREE CHAPTER
    ===================================================== */

    if (isFree) {

        await loadChapterContent(chapter);

        updateChapterSidebar();

        updateNavigationButtons();

        startViewTimer(chapter);

        return;
    }

    /* =====================================================
       PAID CHAPTER
    ===================================================== */

    if (!currentUser) {

        pendingChapter = chapter;

        solToast("Please log in first to unlock full access.");

        openModal("loginModal");

        return;
    }

    /* =====================================================
       CHECK DATABASE PURCHASE
       (this chapter, or the full book)
    ===================================================== */

    const unlocked = await isChapterUnlocked(chapter.id);

    if (!unlocked) {

        pendingChapter = chapter;

        showPaymentModal(chapter);

        return;
    }

    /* =====================================================
       PURCHASE EXISTS
    ===================================================== */

    await loadChapterContent(chapter);

    updateChapterSidebar();

    updateNavigationButtons();

    startViewTimer(chapter);
}

/* =========================================================
   CHECK CHAPTER PURCHASE
   Uses public.purchases
   Unlocked if the user paid for this chapter
   OR paid for the full book.
========================================================= */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === "string" && UUID_RE.test(value);
}

async function isChapterUnlocked(chapterId) {

    if (!currentUser) {
        return false;
    }

    /* IDs go into a filter string below, so only accept real UUIDs */
    if (!isUuid(chapterId) || !isUuid(currentBook?.id)) {
        return false;
    }

    try {

        const { data, error } = await supabaseClient
            .from("purchases")
            .select("id, payment_status")
            .eq("user_id", currentUser.id)
            .eq("payment_status", "paid")
            .or(
                `chapter_id.eq.${chapterId},and(book_id.eq.${currentBook?.id},purchase_type.eq.book)`
            )
            .limit(1)
            .maybeSingle();

        if (error) {

            console.error("Purchase check failed:", error);

            return false;
        }

        return !!data;

    } catch (error) {

        console.error("Purchase check error:", error);

        return false;
    }
}

/* =========================================================
   CHAPTER TEXT FORMATTING
   "quoted text"  or  “quoted text”  ->  bold
   *text*                            ->  italics
   Works on text only (never touches HTML tags), and the same
   function is used for the reader AND the "Continue Reading"
   preview so text positions always match.
========================================================= */

const CHAPTER_ALLOWED_TAGS = [
    "p", "br", "hr", "div", "span", "em", "strong", "b", "i", "u", "s", "sub", "sup",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "a", "img"
];

const CHAPTER_ALLOWED_ATTR = [
    "class", "style", "href", "src", "alt", "title", "target", "rel"
];

/* Strips scripts, event handlers (onerror=...) and javascript: links. */
function sanitizeChapterHtml(html) {

    if (!html) return "";

    if (window.DOMPurify) {

        return window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: CHAPTER_ALLOWED_TAGS,
            ALLOWED_ATTR: CHAPTER_ALLOWED_ATTR
        });
    }

    /* Fallback if the DOMPurify script failed to load: allow-list by hand */
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.body.querySelectorAll("*").forEach(node => {

        if (CHAPTER_ALLOWED_TAGS.indexOf(node.tagName.toLowerCase()) === -1) {
            node.replaceWith(...node.childNodes);
            return;
        }

        Array.from(node.attributes).forEach(attr => {

            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();

            if (
                CHAPTER_ALLOWED_ATTR.indexOf(name) === -1 ||
                ((name === "href" || name === "src") && !/^(https?:|mailto:|\/|#|data:image\/)/.test(value))
            ) {
                node.removeAttribute(attr.name);
            }
        });
    });

    return doc.body.innerHTML;
}

function formatChapterContent(html) {

    if (!html) return "";

    html = sanitizeChapterHtml(html);

    const doc = new DOMParser().parseFromString(html, "text/html");

    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;

    while ((n = walker.nextNode())) textNodes.push(n);

    textNodes.forEach((node) => {

        const text = node.nodeValue;

        if (!text || (text.indexOf("*") === -1 && !/["\u201C]/.test(text))) return;

        /* Skip text inside code / scripts */
        const parent = node.parentElement;
        if (parent && /^(SCRIPT|STYLE|CODE|PRE)$/i.test(parent.tagName)) return;

        let out = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        /* *italics* */
        out = out.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");

        /* "bold"  and  “bold” (quote marks stay visible) */
        out = out.replace(/(\u201C[^\u201D]*\u201D|"[^"]*")/g, "<strong>$1</strong>");

        const tpl = document.createElement("template");
        tpl.innerHTML = out;
        node.replaceWith(tpl.content);
    });

    return doc.body.innerHTML;
}

/* =========================================================
   LOAD CHAPTER CONTENT
   Uses secure SECURITY DEFINER RPC.
========================================================= */

async function loadChapterContent(chapter) {

    if (!chapter) return;

    try {

        const { data, error } = await supabaseClient.rpc(
            "get_chapter_for_reader",
            { p_chapter_id: chapter.id }
        );

        if (error) {

            console.error("Failed to load chapter:", error);

            solToast("Unable to load this chapter.");

            return;
        }

        /*
         * If the RPC returns no rows,
         * the chapter is locked.
         */

        if (!data || data.length === 0) {

            if (!currentUser) {

                pendingChapter = chapter;

                openModal("loginModal");

                return;
            }

            pendingChapter = chapter;

            showPaymentModal(chapter);

            return;
        }

        const loadedChapter = data[0];

        currentChapter = loadedChapter;

        /* =================================================
           UPDATE READER TITLE
        ================================================= */

        const titleElement = $("readerChapterTitle");

        if (titleElement) {

            const cleanTitle = (loadedChapter.title || "").trim();

            titleElement.textContent =
                isDefaultChapterTitle(cleanTitle, loadedChapter.chapter_number)
                    ? `Chapter ${loadedChapter.chapter_number}`
                    : `Chapter ${loadedChapter.chapter_number}: ${cleanTitle}`;
        }

        /* =================================================
           UPDATE CHAPTER HEADING
        ================================================= */

        const heading = $("chapterHeading");

        if (heading) {

            heading.textContent = `Chapter ${loadedChapter.chapter_number}`;
        }

        const numberElement = $("readerChapterNumber");

        if (numberElement) {

            numberElement.textContent = `Chapter ${loadedChapter.chapter_number}`;
        }

        /* =================================================
           UPDATE CONTENT
        ================================================= */

        const contentElement = $("readerContent") || $("storyContent");

        if (contentElement) {

            contentElement.innerHTML = formatChapterContent(loadedChapter.content || "");
        }

        /* Always start a new chapter at the top */
        scrollReaderToTop();

        /* ...unless the reader came back via Continue Reading */
        applyPendingRestore(loadedChapter);

        /* Load the comment section for this chapter (js/comments.js) */
        if (window.SolComments && currentBook && currentChapters[currentChapterIndex]) {
            window.SolComments.open(currentBook.id, currentChapters[currentChapterIndex].id);
        }

        /* The server let us read it, so show it as unlocked */
        const openedMeta = currentChapters[currentChapterIndex];

        if (openedMeta && !isChapterMarkedUnlocked(openedMeta)) {
            unlockedChapterIds.add(openedMeta.id);
            applyLockBadges();
        }

        /* =================================================
           CATEGORY
        ================================================= */

        const category = $("readerCategory");

        if (category) {

            category.textContent = currentBook?.genre || "Romance";
        }

        /* =================================================
           PROGRESS
        ================================================= */

        updateReaderProgress(loadedChapter.chapter_number);

        updateChapterSidebar();

        updateNavigationButtons();

        updateReaderStats(currentBook);

        /*
         * Save reading progress after successfully
         * opening the chapter.
         */

        await saveReadingProgress(loadedChapter);

    } catch (error) {

        console.error("Chapter content error:", error);

        solToast("Something went wrong while opening this chapter.");
    }
}

/* =========================================================
   LEGACY RENDER CHAPTER
   Kept for compatibility with existing HTML.
========================================================= */

function renderChapter(chapter) {

    if (!chapter) return;

    if ($("readerBookTitle")) {
        $("readerBookTitle").textContent = currentBook?.title || "";
    }

    if ($("sidebarBookTitle")) {
        $("sidebarBookTitle").textContent = currentBook?.title || "";
    }

    if ($("readerCategory")) {
        $("readerCategory").textContent = currentBook?.genre || "Romance";
    }

    if ($("chapterHeading")) {
        $("chapterHeading").textContent = `Chapter ${chapter.chapter_number}`;
    }

    if ($("readerChapterTitle")) {
        $("readerChapterTitle").textContent =
            chapter.title || `Chapter ${chapter.chapter_number}`;
    }

    if ($("readerChapterNumber")) {
        $("readerChapterNumber").textContent = `Chapter ${chapter.chapter_number}`;
    }

    const contentElement = $("readerContent") || $("storyContent");

    if (contentElement) {
        contentElement.innerHTML = formatChapterContent(chapter.content || "");
    }

    updateReaderProgress(chapter.chapter_number);

    updateNavigationButtons();

    updateReaderStats(currentBook);
}

/* =========================================================
   UPDATE CHAPTER SIDEBAR
========================================================= */

function updateChapterSidebar() {

    document.querySelectorAll(".chapter-item").forEach((button, index) => {

        button.classList.toggle("active", index === currentChapterIndex);
    });
}

/* =========================================================
   NAVIGATION BUTTONS
========================================================= */

function updateNavigationButtons() {

    const previous = $("previousChapter");
    const next = $("nextChapter");

    if (previous) {
        previous.disabled = currentChapterIndex === 0;
    }

    if (next) {
        next.disabled = currentChapterIndex >= currentChapters.length - 1;
    }
}

/* =========================================================
   READER PROGRESS
========================================================= */

function updateReaderProgress(chapterNumber) {

    const total =
        currentBook?.total_chapters ||
        currentChapters.length ||
        1;

    const percent = Math.round((Number(chapterNumber) / total) * 100);

    const progressText = $("readerProgressText");

    if (progressText) {
        progressText.textContent = `${percent}%`;
    }
}

/* =========================================================
   READING PROGRESS
========================================================= */

/* ---------- helpers: reading the chapter text ---------- */

const EXCERPT_MIN = 90;     // very short paragraphs ("Hello.") are joined with the next one
const EXCERPT_MAX = 260;    // preview is cut at a word boundary and ends with "..."
const BLOCK_TAGS = /^(P|DIV|LI|BLOCKQUOTE|H[1-6]|SECTION|ARTICLE|UL|OL|PRE)$/;

function sameId(a, b) {
    return a !== null && a !== undefined && b !== null && b !== undefined &&
        String(a) === String(b);
}

/* Flattens a chapter into one string and remembers which text node each
   character belongs to. Block edges / <br> count as paragraph breaks, so it
   works for plain text (blank-line paragraphs) and for <p> markup alike. */
function buildTextIndex(root) {

    const nodes = [];
    let full = "";
    let lastBlock = null;

    const blockOf = (node) => {
        let el = node.parentElement;
        while (el && el !== root && !BLOCK_TAGS.test(el.tagName)) el = el.parentElement;
        return el || root;
    };

    const walker = document.createTreeWalker(
        root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );

    let node;

    while ((node = walker.nextNode())) {

        if (node.nodeType === 1) {
            if (node.tagName === "BR") full += "\n";
            continue;
        }

        const text = node.nodeValue;
        if (!text) continue;

        const block = blockOf(node);

        if (lastBlock && block !== lastBlock && !full.endsWith("\n")) full += "\n";

        lastBlock = block;
        nodes.push({ node, start: full.length, len: text.length });
        full += text;
    }

    return { full, nodes };
}

function nodeAtOffset(index, offset) {

    return index.nodes.find(n => offset >= n.start && offset < n.start + n.len) ||
        index.nodes[index.nodes.length - 1] || null;
}

/* The paragraph containing `offset`, trimmed to a short readable excerpt */
function excerptAt(full, offset) {

    const paragraphs = [];
    const re = /[^\n]+/g;
    let m;

    while ((m = re.exec(full))) {

        const text = m[0].replace(/\s+/g, " ").trim();

        if (text && /[\p{L}\p{N}]/u.test(text)) {
            paragraphs.push({ end: m.index + m[0].length, text });
        }
    }

    if (!paragraphs.length) return "";

    let i = paragraphs.findIndex(p => offset < p.end);
    if (i < 0) i = paragraphs.length - 1;

    let text = paragraphs[i].text;

    while (text.length < EXCERPT_MIN && i < paragraphs.length - 1) {
        i++;
        text += " " + paragraphs[i].text;
    }

    if (text.length > EXCERPT_MAX) {
        text = text.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, "") + "...";
    }

    return text;
}

function offsetAtPoint(index, x, y) {

    for (const dy of [0, 14, 28, 42]) {

        let node = null;
        let off = 0;

        if (document.caretPositionFromPoint) {
            const p = document.caretPositionFromPoint(x, y + dy);
            if (p) { node = p.offsetNode; off = p.offset; }
        } else if (document.caretRangeFromPoint) {
            const r = document.caretRangeFromPoint(x, y + dy);
            if (r) { node = r.startContainer; off = r.startOffset; }
        }

        const entry = node && index.nodes.find(n => n.node === node);

        if (entry) return entry.start + Math.min(off, entry.len);
    }

    return null;
}

/* ---------- capture / restore the reader's position ---------- */

/* Where is the reader right now?  { offset, ratio, excerpt } or null */
function captureReadingPosition() {

    const reader = $("readerSection");
    const scroller = document.querySelector(".story-reader");
    const content = $("storyContent");

    if (!reader || !scroller || !content || reader.classList.contains("hidden")) return null;

    const sr = scroller.getBoundingClientRect();

    if (!sr.height) return null;

    const index = buildTextIndex(content);

    if (!index.full.trim()) return null;

    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;

    let offset = 0;

    const probeY = sr.top + Math.min(90, sr.height * 0.2);
    const cr = content.getBoundingClientRect();

    /* still on the chapter heading / first lines? then they are at the start */
    if (scroller.scrollTop > 4 && cr.top < probeY) {

        const x = Math.min(cr.right - 4, Math.max(cr.left + 4, sr.left + sr.width / 2));

        const hit = offsetAtPoint(index, x, probeY);

        offset = hit !== null ? hit : Math.round(ratio * index.full.length);
    }

    return { offset, ratio, excerpt: excerptAt(index.full, offset) };
}

/* Scroll the reader so the saved paragraph sits where it was when they stopped */
function restoreReadingPosition(target) {

    const scroller = document.querySelector(".story-reader");
    const content = $("storyContent");

    if (!scroller || !content) return;

    const index = buildTextIndex(content);

    const max = scroller.scrollHeight - scroller.clientHeight;
    let top = null;

    const sr = scroller.getBoundingClientRect();
    const probe = Math.min(90, sr.height * 0.2);

    if (target.offset > 0 && target.offset < index.full.length) {

        const entry = nodeAtOffset(index, target.offset);

        if (entry) {

            const range = document.createRange();
            const at = Math.min(target.offset - entry.start, entry.len - 1);

            range.setStart(entry.node, Math.max(0, at));
            range.setEnd(entry.node, Math.max(0, at) + 1);

            const rect = range.getBoundingClientRect();

            if (rect.height) top = scroller.scrollTop + (rect.top - sr.top) - probe;
        }
    }

    if (top === null && target.ratio > 0 && max > 0) top = target.ratio * max;

    if (top === null) return;

    top = Math.max(0, Math.round(top));

    scroller.scrollTop = top;

    /* fonts / highlights can nudge the layout a moment later: re-apply once if untouched */
    if (!target.__again) {
        setTimeout(() => {
            if (Math.abs(scroller.scrollTop - top) < 3) {
                restoreReadingPosition({ ...target, __again: true });
            }
        }, 350);
    }
}

function applyPendingRestore(chapter) {

    const target = pendingRestore;

    if (!target || !chapter) return;

    const matches =
        sameId(target.bookId, currentBook?.id) &&
        (sameId(target.chapterId, chapter.id) ||
            Number(target.chapterNumber) === Number(chapter.chapter_number));

    if (!matches) return;

    pendingRestore = null;

    restoreReadingPosition(target);
}

/* ---------- saving ---------- */

function localPositionKey() {
    return "solReadPos.v1:" + (currentUser ? currentUser.id : "guest");
}

function readLocalPositions() {
    try {
        const all = JSON.parse(localStorage.getItem(localPositionKey()) || "{}");
        return all && typeof all === "object" ? all : {};
    } catch (e) {
        return {};
    }
}

function writeLocalPosition(state) {

    const all = readLocalPositions();

    all[String(state.bookId)] = state;

    const newest = Object.entries(all)
        .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
        .slice(0, 20);

    try {
        localStorage.setItem(localPositionKey(), JSON.stringify(Object.fromEntries(newest)));
    } catch (e) { /* storage full / blocked: the database copy still works */ }
}

function latestLocalPosition() {

    return Object.values(readLocalPositions())
        .filter(p => p && books.some(b => sameId(b.id, p.bookId)))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null;
}

function isMissingColumnError(error) {
    return !!error && (
        error.code === "PGRST204" ||
        error.code === "42703" ||
        /read_offset|scroll_ratio|last_excerpt/i.test(error.message || "")
    );
}

/* One row per user+book in the EXISTING reading_progress table */
function upsertProgress(userId, state) {

    progressQueue = progressQueue.then(async () => {

        const base = {
            user_id: userId,
            book_id: state.bookId,
            chapter_id: state.chapterId,
            chapter_number: state.chapterNumber,
            progress_percent: state.percent,
            updated_at: new Date(state.ts).toISOString()
        };

        const extra = {
            read_offset: state.offset,
            scroll_ratio: state.ratio,
            last_excerpt: state.excerpt || null
        };

        const options = { onConflict: "user_id,book_id" };

        try {

            let { error } = await supabaseClient
                .from("reading_progress")
                .upsert(positionColumns ? { ...base, ...extra } : base, options);

            /* DB not migrated yet: keep saving chapter + percent exactly as before */
            if (error && positionColumns && isMissingColumnError(error)) {

                positionColumns = false;

                ({ error } = await supabaseClient
                    .from("reading_progress")
                    .upsert(base, options));
            }

            if (error) console.error("Progress save error:", error);

        } catch (error) {

            console.error("Progress error:", error);
        }
    });

    return progressQueue;
}

/* Remember the spot (device + account) and refresh the Continue Reading card */
function persistReadingState(book, chapter, pos) {

    const total = Number(book.total_chapters || 49);
    const chapterNumber = Number(chapter.chapter_number) || 1;

    const percent = Math.min(
        100,
        Math.round(((chapterNumber - 1) + pos.ratio) / total * 100)
    );

    const state = {
        bookId: book.id,
        chapterId: chapter.id,
        chapterNumber,
        offset: pos.offset,
        ratio: pos.ratio,
        excerpt: pos.excerpt || "",
        percent,
        ts: Date.now()
    };

    writeLocalPosition(state);

    renderContinue(state);

    if (currentUser) upsertProgress(currentUser.id, state);
}

/* Save where the reader is right now (leaving the page, closing the reader, pausing) */
function flushReadingPosition() {

    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
    positionBurstStart = 0;

    if (!currentBook || !currentChapter) return;

    const pos = captureReadingPosition();

    if (pos) persistReadingState(currentBook, currentChapter, pos);
}

function scheduleReadingPositionSave() {

    if (!currentBook || !currentChapter) return;

    const now = Date.now();

    if (!positionBurstStart) positionBurstStart = now;

    clearTimeout(positionSaveTimer);

    /* save once they pause; never go more than ~15s of scrolling without saving */
    const wait = now - positionBurstStart > 15000 ? 0 : 1500;

    positionSaveTimer = setTimeout(flushReadingPosition, wait);
}

function setupReadingPositionTracking() {

    const scroller = document.querySelector(".story-reader");

    if (scroller) {
        scroller.addEventListener("scroll", scheduleReadingPositionSave, { passive: true });
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushReadingPosition();
    });

    window.addEventListener("pagehide", flushReadingPosition);
}

/* Called every time a chapter opens (the position is the top, or the restored spot) */
async function saveReadingProgress(chapter) {

    clearTimeout(positionSaveTimer);

    if (!currentBook || !chapter) return;

    const pos = captureReadingPosition() || { offset: 0, ratio: 0, excerpt: "" };

    persistReadingState(currentBook, chapter, pos);
}

/* =========================================================
   LOAD CONTINUE READING
   Latest of: this account's saved progress (database) and
   this device's saved position. Guests use the device copy.
========================================================= */

async function loadContinueReading() {

    if (!books.length) return;

    const local = latestLocalPosition();

    let row = null;

    if (currentUser) {

        try {

            const baseCols =
                "book_id, chapter_id, chapter_number, progress_percent, updated_at";

            const query = (cols) => supabaseClient
                .from("reading_progress")
                .select(cols)
                .eq("user_id", currentUser.id)
                .order("updated_at", { ascending: false })
                .limit(1);

            let res = await query(
                positionColumns
                    ? baseCols + ", read_offset, scroll_ratio, last_excerpt"
                    : baseCols
            );

            if (res.error && positionColumns && isMissingColumnError(res.error)) {
                positionColumns = false;
                res = await query(baseCols);
            }

            if (res.error) console.error("Continue reading error:", res.error);

            row = res.data && res.data[0] ? res.data[0] : null;

        } catch (error) {

            console.error("Continue reading failed:", error);
        }
    }

    const rowBook = row && books.find(b => sameId(b.id, row.book_id));
    const rowTime = row ? Date.parse(row.updated_at) || 0 : 0;

    let state = null;

    if (local && (!rowBook || local.ts > rowTime)) {

        /* this device is ahead of the database (e.g. the tab was closed mid-save) */
        state = local;

        if (currentUser) upsertProgress(currentUser.id, local);

    } else if (rowBook) {

        let chapterNumber = Number(row.chapter_number || 0);

        if (!chapterNumber && row.chapter_id) {

            const { data: chapter } = await supabaseClient
                .from("chapters")
                .select("chapter_number")
                .eq("id", row.chapter_id)
                .maybeSingle();

            chapterNumber = Number(chapter?.chapter_number || 1);
        }

        state = {
            bookId: row.book_id,
            chapterId: row.chapter_id,
            chapterNumber: chapterNumber || 1,
            offset: Number(row.read_offset) || 0,
            ratio: Number(row.scroll_ratio) || 0,
            excerpt: row.last_excerpt || "",
            percent: Number(row.progress_percent) || 0,
            ts: rowTime
        };

        /* older rows have no position: borrow it from this device if it is the same chapter */
        if (local && sameId(local.bookId, state.bookId) &&
            Number(local.chapterNumber) === state.chapterNumber) {

            state.offset = state.offset || local.offset || 0;
            state.ratio = state.ratio || local.ratio || 0;
            state.excerpt = state.excerpt || local.excerpt || "";
        }
    }

    renderContinue(state);

    /* saved before excerpts existed: read the real chapter text to build one */
    if (state && !state.excerpt && currentUser && state.chapterId) {
        fillMissingExcerpt(state);
    }
}

async function fillMissingExcerpt(state) {

    try {

        const { data, error } = await supabaseClient.rpc(
            "get_chapter_for_reader",
            { p_chapter_id: state.chapterId }
        );

        if (error || !data || !data.length || !data[0].content) return;

        const doc = new DOMParser().parseFromString(formatChapterContent(data[0].content), "text/html");
        const index = buildTextIndex(doc.body);

        const offset = state.offset || Math.floor((state.ratio || 0) * index.full.length);
        const excerpt = excerptAt(index.full, offset);

        if (!excerpt || !continueState || !sameId(continueState.chapterId, state.chapterId)) return;

        renderContinue({ ...state, excerpt });

    } catch (error) {

        console.error("Excerpt lookup failed:", error);
    }
}

/* =========================================================
   CONTINUE READING CARD
   state = { bookId, chapterId, chapterNumber, offset, ratio, excerpt, percent }
   state === null  ->  nothing read yet: "Start reading this story..."
========================================================= */

function renderContinue(state) {

    const book = state
        ? books.find(b => sameId(b.id, state.bookId))
        : books[0] || null;

    if (state && !book) state = null;

    const hasProgress = !!state;
    const chapterNumber = hasProgress ? state.chapterNumber : 1;
    const total = Number(book?.total_chapters || 49);
    const percent = hasProgress ? Math.min(100, Math.max(0, Number(state.percent) || 0)) : 0;

    continueState = hasProgress ? { ...state, book } : null;

    const preview = $("continuePreview");

    if (preview) {

        const excerpt = hasProgress ? state.excerpt : "";

        preview.textContent = excerpt
            ? `\u201C${excerpt}\u201D`
            : hasProgress
                ? "Pick up right where you left off."
                : "Start reading this story...";

        preview.classList.toggle("is-empty", !excerpt);
    }

    if ($("continueTitle")) $("continueTitle").textContent = book ? book.title : "Your story";
    if ($("continueChapter")) $("continueChapter").textContent = `Chapter ${chapterNumber}`;
    if ($("progressPercent")) $("progressPercent").textContent = `${Math.round(percent)}%`;
    if ($("progressNumbers")) $("progressNumbers").textContent = `${chapterNumber} / ${total}`;
    if ($("continueProgress")) $("continueProgress").style.width = `${percent}%`;

    const button = $("continueButton");

    if (button) {
        button.textContent = hasProgress ? "Continue Reading" : "Start Reading";
        button.disabled = !book;
    }
}

/* =========================================================
   CONTINUE READING BUTTON
   Opens the saved chapter AND scrolls to the saved paragraph.
========================================================= */

async function continueReading() {

    if (!books.length) {

        solToast("Books are still loading.");

        return;
    }

    if (!continueState) await loadContinueReading();

    const target = continueState;

    if (!target) {

        const first = books[0];

        if (first) await openReader(first.id, 1);

        return;
    }

    pendingRestore = {
        bookId: target.bookId,
        chapterId: target.chapterId,
        chapterNumber: target.chapterNumber,
        offset: target.offset,
        ratio: target.ratio
    };

    try {

        await openReader(target.bookId, target.chapterNumber);

    } finally {

        /* a locked chapter never rendered: don't leak the jump into the next chapter */
        pendingRestore = null;
    }
}

/* =========================================================
   PAYMENT MODAL
   Shows the price of the CURRENT book (books.price)
========================================================= */

function showPaymentModal(chapter) {

    if (!chapter) return;

    const title = $("paymentChapterTitle");
    const amount = $("paymentAmount");
    const payButton = $("demoPaymentButton");

    if (title) {

        title.textContent = currentBook
            ? `Unlock ${currentBook.title}`
            : "Full Book Access";
    }

    if (amount) {

        amount.textContent = getBookPrice(currentBook);
    }

    if (payButton) {

        payButton.disabled = false;

        payButton.textContent = "Proceed to Payment";
    }

    openModal("paymentModal");
}

/* =========================================================
   START REAL PAYMENT
========================================================= */

async function startRealPayment() {

    if (!pendingChapter) {

        closeModal("paymentModal");

        return;
    }

    if (!currentUser) {

        closeModal("paymentModal");

        openModal("loginModal");

        return;
    }

    const button = $("demoPaymentButton");

    if (!button) {

        console.error("Payment button not found.");

        return;
    }

    const originalText = button.textContent;

    button.disabled = true;

    button.textContent = "Redirecting to payment...";

    try {

        /*
         * We use supabase.functions.invoke()
         * so the logged-in session is sent automatically.
         *
         * The Edge Function looks up the real price from
         * books.price using the book ID.
         * Never trust a price sent from the browser.
         */

        const { data, error } = await supabaseClient.functions.invoke(
            "create-payment",
            {
                body: {
                    chapterId: pendingChapter.id,
                    bookId: currentBook?.id
                }
            }
        );

        if (error) {

            console.error("Create payment error:", error);

            solToast("Failed to create payment. Please try again.");

            button.disabled = false;

            button.textContent = originalText;

            return;
        }

        if (!data || data.error) {

            console.error(data);

            solToast(
                data?.error ||
                "Failed to create payment. Please try again."
            );

            button.disabled = false;

            button.textContent = originalText;

            return;
        }

        if (data.already_purchased) {

            closeModal("paymentModal");

            solToast("You already own this book. Reloading your chapters...");

            setTimeout(() => window.location.reload(), 1200);

            return;
        }

        if (!data.checkout_url) {

            console.error("No checkout URL returned:", data);

            solToast("Payment checkout URL was not returned.");

            button.disabled = false;

            button.textContent = originalText;

            return;
        }

        /*
         * Remember what is being bought so we can unlock it
         * and jump straight to it after PayMongo sends the reader back.
         */

        try {

            sessionStorage.setItem("sol-pending-payment", JSON.stringify({
                chapterId: pendingChapter.id,
                chapterNumber: pendingChapter.chapter_number,
                bookId: currentBook?.id || null
            }));

        } catch (e) {}

        /*
         * Redirect to PayMongo.
         */

        window.location.href = data.checkout_url;

    } catch (error) {

        console.error("Payment error:", error);

        solToast("Something went wrong while creating the payment.");

        button.disabled = false;

        button.textContent = originalText;
    }
}

/* =========================================================
   HANDLE PAYMENT RETURN
========================================================= */

let paymentReturn = null;

function handlePaymentReturn() {

    const urlParams = new URLSearchParams(window.location.search);

    const paymentStatus = urlParams.get("payment");

    const urlChapterId = urlParams.get("chapter");

    if (paymentStatus !== "success" && paymentStatus !== "cancelled") return;

    /* Remove payment parameters from the address bar. */

    window.history.replaceState({}, document.title, window.location.pathname);

    if (paymentStatus === "cancelled") {

        try { sessionStorage.removeItem("sol-pending-payment"); } catch (e) {}

        solToast("Payment was cancelled.");

        return;
    }

    /*
     * IMPORTANT: this is NOT an unlock. The webhook marks the purchase
     * as "paid" in Supabase; we only wait for it (see verifyPaymentAndUnlock).
     */

    let pending = {};

    try {
        pending = JSON.parse(sessionStorage.getItem("sol-pending-payment") || "{}");
        sessionStorage.removeItem("sol-pending-payment");
    } catch (e) {}

    paymentReturn = {
        chapterId: pending.chapterId || urlChapterId || null,
        chapterNumber: pending.chapterNumber || 1,
        bookId: pending.bookId || null
    };
}

async function hasPaidPurchase(ret) {

    if (!currentUser || !isUuid(ret.chapterId)) return false;

    const filter = isUuid(ret.bookId)
        ? `chapter_id.eq.${ret.chapterId},and(book_id.eq.${ret.bookId},purchase_type.eq.book)`
        : `chapter_id.eq.${ret.chapterId}`;

    const { data, error } = await supabaseClient
        .from("purchases")
        .select("id")
        .eq("user_id", currentUser.id)
        .eq("payment_status", "paid")
        .or(filter)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Payment check failed:", error);
        return false;
    }

    return !!data;
}

/* The webhook can arrive a few seconds after the redirect, so check
   every 2 seconds for up to 30 seconds before giving up. */
async function verifyPaymentAndUnlock(ret) {

    if (!currentUser) {

        solToast("Please log in to finish unlocking your purchase.");

        openModal("loginModal");

        return;
    }

    const hide = solToast("Payment received. Confirming your purchase...", { sticky: true });

    let paid = false;

    for (let attempt = 0; attempt < 15 && !paid; attempt++) {

        try { paid = await hasPaidPurchase(ret); } catch (e) { console.error(e); }

        if (!paid) await new Promise(resolve => setTimeout(resolve, 2000));
    }

    hide();

    if (!paid) {

        solToast(
            "Still confirming your payment. Refresh in a minute. " +
            "If it stays locked, please contact us.",
            { duration: 9000 }
        );

        return;
    }

    solToast("Unlocked! Enjoy the story.");

    const book = books.find(b => b.id === ret.bookId);

    if (book) {
        await openReader(book.id, ret.chapterNumber);
    } else if (currentBook) {
        await refreshUnlockedState();
    }
}

/* =========================================================
   VIEWS
========================================================= */

function startViewTimer(chapter) {

    if (!chapter) return;

    if (viewTimer) {

        clearTimeout(viewTimer);
    }

    const key = `viewed-chapter-${chapter.id}`;

    if (localStorage.getItem(key) === "true") {

        return;
    }

    viewTimer = setTimeout(
        async () => {

            if (currentBook && currentUser) {

                await incrementViews(currentBook.id);

                /* only a cache so we skip pointless calls; the server decides */
                localStorage.setItem(key, "true");
            }
        },
        30000
    );
}

/* =========================================================
   INCREMENT VIEWS
========================================================= */

async function incrementViews(bookId) {

    /* Views are counted once per logged-in reader, enforced by the
       increment_views() function in Supabase (see sql/01_votes_views.sql). */
    if (!currentUser) return;

    try {

        const book = books.find(b => b.id === bookId);

        if (!book) return;

        const { data, error } = await supabaseClient.rpc(
            "increment_views",
            { p_book_id: bookId }
        );

        if (error) {

            console.error("View increment error:", error);

            return;
        }

        if (data !== null && data !== undefined) {

            book.views = Number(data) || 0;

            applySort(currentSort);

            updateReaderStats(book);
        }

    } catch (err) {

        console.error("Failed to increment views:", err);
    }
}

/* =========================================================
   VOTE BOOK
========================================================= */

function votedKey(bookId) {
    return `voted-book-${currentUser ? currentUser.id : "anon"}-${bookId}`;
}

function markVoteButtonVoted(btn, btnText) {

    if (btn) {
        btn.classList.add("voted");
        btn.disabled = true;
    }

    if (btnText) btnText.textContent = "Voted";
}

/* Ask the server whether THIS account already voted (works on any device). */
async function syncVoteState(bookId) {

    if (!currentUser) return;

    try {

        const { data, error } = await supabaseClient
            .from("book_votes")
            .select("book_id")
            .eq("book_id", bookId)
            .eq("user_id", currentUser.id)
            .maybeSingle();

        if (error) {
            console.error("Vote check failed:", error);
            return;
        }

        if (data) {
            try { localStorage.setItem(votedKey(bookId), "true"); } catch (e) {}
            markVoteButtonVoted($("voteButton"), $("voteButtonText"));
        }

    } catch (err) {

        console.error("Vote check error:", err);
    }
}

async function voteBook(bookId) {

    if (!currentUser) {

        solToast("Please log in to vote.");

        openModal("loginModal");

        return;
    }

    const book = books.find(b => b.id === bookId);

    if (!book) return;

    const btn = $("voteButton");
    const btnText = $("voteButtonText");

    if (btn) btn.disabled = true;

    try {

        const { data, error } = await supabaseClient.rpc(
            "cast_vote",
            { p_book_id: bookId }
        );

        if (error) {

            console.error("Vote error:", error);

            solToast("Couldn't register your vote. Please try again.");

            if (btn) btn.disabled = false;

            return;
        }

        const result = data || {};

        if (result.votes !== undefined && result.votes !== null) {
            book.votes = Number(result.votes) || 0;
        }

        try { localStorage.setItem(votedKey(bookId), "true"); } catch (e) {}

        const countEl = $("modalVoteCount");

        if (countEl) {
            countEl.textContent = (Number(book.votes) || 0).toLocaleString();
        }

        markVoteButtonVoted(btn, btnText);

        if (btn && !result.already_voted) {

            btn.classList.add("just-voted");

            setTimeout(() => btn.classList.remove("just-voted"), 700);
        }

        applySort(currentSort);

        updateReaderStats(book);

    } catch (err) {

        console.error("Failed to vote:", err);

        if (btn) btn.disabled = false;
    }
}

/* =========================================================
   GENRES
========================================================= */

function setupGenreButtons() {

    document.querySelectorAll(".genre-card").forEach(button => {

        button.addEventListener("click", () => {

            const genre = button.dataset.genre;

            // tapping the active genre again clears the filter
            filterBooksByGenre(currentGenre === genre ? "" : genre);

            // results live above the genre buttons, so bring them into view
            const target = $("books");
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

function filterBooksByGenre(genre) {

    currentGenre = genre || "";

    document.querySelectorAll(".genre-card").forEach(button => {
        const on = !!currentGenre && button.dataset.genre === currentGenre;
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
    });

    applySort(currentSort);
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {

    if (value === null || value === undefined) {

        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =========================================================
   SEARCH BOOKS
========================================================= */

function setupBookSearch() {

    const searchInput = $("bookSearch");
    const searchForm = $("bookSearchForm");

    if (!searchInput) return;

    let timer = null;

    const runSearch = () => {
        currentQuery = searchInput.value.trim();
        if (books.length) applySort(currentSort);
    };

    // live results while typing (short debounce keeps phones smooth)
    searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(runSearch, 120);
    });

    // Enter key / search icon: run immediately, close the keyboard on phones
    if (searchForm) {
        searchForm.addEventListener("submit", (event) => {
            event.preventDefault();
            clearTimeout(timer);
            runSearch();
            searchInput.blur();
        });
    }

    // the "x" clear button on type="search" fires a "search" event
    searchInput.addEventListener("search", runSearch);
}

/* =========================================================
   READER CONTROLS (Sidebar + Font Size + Font Family)
========================================================= */

function setupReaderExtras() {

    // Sidebar toggle
    const toggleBtn = $("toggleSidebar");

    if (toggleBtn) {

        toggleBtn.addEventListener("click", () => {

            const layout = document.querySelector(".reader-layout");

            if (layout) {

                layout.classList.toggle("sidebar-hidden");

                toggleBtn.textContent =
                    layout.classList.contains("sidebar-hidden")
                        ? "☰ Show Chapters"
                        : "☰ Chapters";
            }
        });
    }

    // Font size
    let currentSize = 18; // default px

    const decreaseBtn = $("fontDecrease");
    const increaseBtn = $("fontIncrease");

    const applyFontSize = () => {

        const content = $("storyContent") || $("readerContent");

        if (content) {

            content.style.fontSize = currentSize + "px";
        }

        localStorage.setItem("readerFontSize", currentSize);
    };

    if (decreaseBtn) {

        decreaseBtn.addEventListener("click", () => {

            if (currentSize > 14) {

                currentSize -= 2;

                applyFontSize();
            }
        });
    }

    if (increaseBtn) {

        increaseBtn.addEventListener("click", () => {

            if (currentSize < 28) {

                currentSize += 2;

                applyFontSize();
            }
        });
    }

    // Restore saved font size
    const savedSize = localStorage.getItem("readerFontSize");

    if (savedSize) {

        currentSize = Number(savedSize);

        applyFontSize();
    }

    // Font family
    const fontSelect = $("fontFamily");

    if (fontSelect) {

        // Restore saved font
        const savedFont = localStorage.getItem("readerFontFamily");

        if (savedFont) {

            fontSelect.value = savedFont;

            applyFontFamily(savedFont);
        }

        fontSelect.addEventListener("change", () => {

            const font = fontSelect.value;

            applyFontFamily(font);

            localStorage.setItem("readerFontFamily", font);
        });
    }

    function applyFontFamily(font) {

        const content = $("storyContent") || $("readerContent");

        if (content) {

            content.style.fontFamily = font;
        }
    }
}

/* =========================================================
   READER BRIDGE (used by js/bookmarks.js)
   Exposes just what the bookmark feature needs.
========================================================= */

window.SolReader = {
    state: () => ({
        book: currentBook,
        chapter: currentChapters[currentChapterIndex] || null
    }),
    user: () => currentUser,
    db: () => supabaseClient,
    open: (bookId, chapterNumber) => {
        /* bookmarks may store the id as text; use the real id from the books list */
        const match = books.find(item => String(item.id) === String(bookId));
        return openReader(match ? match.id : bookId, chapterNumber);
    },
    closeModal: (id) => closeModal(id)
};