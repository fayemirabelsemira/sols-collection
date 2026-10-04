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
   - Updated: ₱150 Full Book Access
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

/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

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
    setupReaderExtras();   // ← add this
    setupGenreButtons();
    setupSortButtons();

    await checkUser();
    await loadBooks();
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

        localStorage.setItem(
            "solsTheme",
            isDark ? "dark" : "light"
        );

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

        loginButton.addEventListener(
            "click",
            () => openModal("loginModal")
        );

    }

    if (signupButton) {

        signupButton.addEventListener(
            "click",
            () => openModal("signupModal")
        );

    }

    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            logout
        );

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

        mobileLogoutButton.addEventListener(
            "click",
            logout
        );

    }

    document.querySelectorAll(".mobile-menu a").forEach(link => {

        link.addEventListener(
            "click",
            closeMobileMenu
        );

    });

    const heroContinueButton = $("heroContinueButton");

    if (heroContinueButton) {

        heroContinueButton.addEventListener(
            "click",
            continueReading
        );

    }

    const continueButton = $("continueButton");

    if (continueButton) {

        continueButton.addEventListener(
            "click",
            continueReading
        );

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

            openReader(
                currentBook.id,
                1
            );

        });

    }

    const paymentButton = $("demoPaymentButton");

    if (paymentButton) {

        paymentButton.addEventListener(
            "click",
            startRealPayment
        );

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

        const {
            data,
            error
        } = await supabaseClient.auth.getUser();

        if (error) {

            console.error(
                "Auth error:",
                error
            );

            currentUser = null;

        } else {

            currentUser = data.user || null;

        }

        updateAuthUI();

    } catch (error) {

        console.error(
            "Unable to check user:",
            error
        );

        currentUser = null;

        updateAuthUI();
    }

    supabaseClient.auth.onAuthStateChange(
        async (_event, session) => {

            currentUser = session?.user || null;

            updateAuthUI();

            if (currentUser) {

                await loadContinueReading();

            } else {

                updateContinueDisplay(
                    1,
                    books[0] || null
                );

            }

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

        loginForm.addEventListener(
            "submit",
            login
        );

    }

    if (signupForm) {

        signupForm.addEventListener(
            "submit",
            signup
        );

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

        const {
            data,
            error
        } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {

            alert(
                "Login failed: " +
                error.message
            );

            return;
        }

        currentUser = data.user;

        updateAuthUI();

        closeModal("loginModal");

        $("loginForm").reset();

        alert("Welcome back!");

        await loadContinueReading();

        /*
         * If the user was trying to purchase before logging in,
         * continue the purchase flow.
         */

        if (pendingChapter) {

            const chapter = pendingChapter;

            if (
                currentChapters.length > 0 &&
                currentChapters.some(
                    c => c.id === chapter.id
                )
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

        alert(
            "Something went wrong while logging in."
        );
    }
}

async function signup(event) {

    event.preventDefault();

    const name = $("signupName").value.trim();
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;

    try {

        const {
            data,
            error
        } = await supabaseClient.auth.signUp({

            email,
            password,

            options: {
                data: {
                    display_name: name
                }
            }

        });

        if (error) {

            alert(
                "Sign up failed: " +
                error.message
            );

            return;
        }

        $("signupForm").reset();

        closeModal("signupModal");

        if (data.session) {

            currentUser = data.user;

            updateAuthUI();

            alert(
                "Account created successfully!"
            );

        } else {

            alert(
                "Account created! Please check your email to confirm your account."
            );

        }

    } catch (error) {

        console.error(error);

        alert(
            "Something went wrong while creating your account."
        );
    }
}

async function logout() {

    const {
        error
    } = await supabaseClient.auth.signOut();

    if (error) {

        alert(
            "Logout failed: " +
            error.message
        );

        return;
    }

    currentUser = null;

    pendingChapter = null;

    updateAuthUI();

    closeReader();

    alert(
        "You have been logged out."
    );
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

        const {
            data,
            error
        } = await supabaseClient
            .from("books")
            .select("*")
            .order(
                "created_at",
                {
                    ascending: false
                }
            );

        if (error) {

            console.error(
                "Books error:",
                error
            );

            if (loading) {
                loading.textContent =
                    "Unable to load books.";
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

        console.error(
            "Load books error:",
            error
        );

        if (loading) {

            loading.textContent =
                "Unable to load books.";

        }
    }
}

/* =========================================================
   SORTING
========================================================= */

function setupSortButtons() {

    document.querySelectorAll(".sort-button")
        .forEach(btn => {

            btn.addEventListener("click", () => {

                document
                    .querySelectorAll(".sort-button")
                    .forEach(b =>
                        b.classList.remove("active")
                    );

                btn.classList.add("active");

                currentSort =
                    btn.dataset.sort;

                applySort(currentSort);

            });

        });
}

function applySort(type) {

    let sorted = [...books];

    if (type === "popular") {

        sorted.sort(
            (a, b) =>
                (Number(b.views) || 0) -
                (Number(a.views) || 0)
        );

    } else if (type === "voted") {

        sorted.sort(
            (a, b) =>
                (Number(b.votes) || 0) -
                (Number(a.votes) || 0)
        );

    } else {

        sorted.sort(
            (a, b) =>
                new Date(b.created_at) -
                new Date(a.created_at)
        );

    }

    renderBooks(sorted);
}

function renderBooks(list = books) {

    const booksGrid = $("booksGrid");

    if (!booksGrid) return;

    booksGrid.innerHTML = "";

    list.forEach(book => {

        const card = document.createElement("article");
        card.className = "book-card";

        const genre = book.genre || "Romance";
        const chapters = book.total_chapters || 0;

        const views = Number(book.views || 2000000).toLocaleString();
        const votes = Number(book.votes || 100000).toLocaleString();

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
                    <span>👁 ${views}</span>
                    <span>☀ ${votes}</span>
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

    const book =
        books.find(item =>
            item.id === bookId
        );

    if (!book) return;

    currentBook = book;

    $("modalBookTitle").textContent =
        book.title;

    $("modalBookAuthor").textContent =
        `By ${book.author || "Sol"}`;

    $("modalBookDescription").textContent =
        book.description ||
        "No description available.";

    $("modalBookGenre").textContent =
        book.genre || "Romance";

    /*
     * Calculate free chapter count from the database.
     */

    let freeChapterCount = 5;

    try {

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "get_book_chapter_metadata",
            {
                p_book_id: book.id
            }
        );

        if (!error && data) {

            freeChapterCount =
                data.filter(
                    chapter => chapter.is_free === true
                ).length;

        }

    } catch (error) {

        console.warn(
            "Unable to load free chapter count:",
            error
        );

    }

    if ($("modalFreeChapters")) {

        $("modalFreeChapters").textContent =
            freeChapterCount;

    }

    const views =
        Number(
            book.views || 2000000
        ).toLocaleString();

    const votes =
        Number(
            book.votes || 100000
        ).toLocaleString();

    const alreadyVoted =
        localStorage.getItem(
            `voted-book-${book.id}`
        ) === "true";

    let statsContainer =
        document.getElementById("modalStats");

    if (!statsContainer) {

        statsContainer =
            document.createElement("div");

        statsContainer.id =
            "modalStats";

        statsContainer.className =
            "modal-stats";

        $("modalBookDescription")
            .after(statsContainer);

    }

    statsContainer.innerHTML = `

        <span>
            👁
            <strong>
                ${views}
            </strong>
            views
        </span>

        <span>
            ☀
            <strong id="modalVoteCount">
                ${votes}
            </strong>
            votes
        </span>

        <button
            id="voteButton"
            class="vote-button ${alreadyVoted ? "voted" : ""}"
            type="button"
            ${alreadyVoted ? "disabled" : ""}
        >

            <span class="sun">
                ☀
            </span>

            <span id="voteButtonText">
                ${alreadyVoted ? "Voted" : "Vote"}
            </span>

        </button>
    `;

    const voteBtn =
        $("voteButton");

    if (voteBtn && !alreadyVoted) {

        voteBtn.onclick =
            () => voteBook(book.id);

    }

    const cover =
        $("modalBookCover");

    if (cover) {

        cover.className =
            "modal-book-cover lores-cover";

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
}

/* =========================================================
   READER
========================================================= */

async function openReader(
    bookId,
    chapterNumber = 1
) {

    const book =
        books.find(item =>
            item.id === bookId
        );

    if (!book) return;

    currentBook = book;

    currentChapterIndex =
        Math.max(
            0,
            Number(chapterNumber) - 1
        );

    const reader =
        $("readerSection");

    if (reader) {

        reader.classList.remove("hidden");

        reader.classList.add("active");

    }

    document.body.classList.add(
        "reader-open"
    );

    if ($("readerBookTitle")) {

        $("readerBookTitle").textContent =
            book.title;

    }

    if ($("sidebarBookTitle")) {

        $("sidebarBookTitle").textContent =
            book.title;

    }

    updateReaderStats(book);

    await loadChapterList();

    /*
     * Make sure the requested chapter exists.
     */

    if (
        currentChapterIndex >=
        currentChapters.length
    ) {

        currentChapterIndex = 0;

    }

    await openChapter(
        currentChapterIndex
    );

    if (reader) {

        reader.scrollIntoView({
            behavior: "smooth"
        });

    }
}

function updateReaderStats(book) {

    const viewsEl =
        $("readerViews");

    const votesEl =
        $("readerVotes");

    if (viewsEl) {

        viewsEl.textContent =
            `👁 ${Number(
                book.views || 2000000
            ).toLocaleString()}`;

    }

    if (votesEl) {

        votesEl.textContent =
            `☀ ${Number(
                book.votes || 100000
            ).toLocaleString()}`;

    }
}

function closeReader() {

    if (viewTimer) {

        clearTimeout(viewTimer);

        viewTimer = null;

    }

    const reader =
        $("readerSection");

    if (reader) {

        reader.classList.add("hidden");

        reader.classList.remove("active");

    }

    document.body.classList.remove(
        "reader-open"
    );

    currentBook = null;
    currentChapters = [];
    currentChapter = null;
    currentChapterIndex = 0;
}

/* =========================================================
   READER CONTROLS
========================================================= */

function setupReaderControls() {

    const closeButton =
        $("closeReaderButton");

    const previousButton =
        $("previousChapter");

    const nextButton =
        $("nextChapter");

    if (closeButton) {

        closeButton.addEventListener(
            "click",
            closeReader
        );

    }

    if (previousButton) {

        previousButton.addEventListener(
            "click",
            async () => {

                if (
                    currentChapterIndex > 0
                ) {

                    await openChapter(
                        currentChapterIndex - 1
                    );

                }

            }
        );

    }

    if (nextButton) {

        nextButton.addEventListener(
            "click",
            async () => {

                if (
                    currentChapterIndex <
                    currentChapters.length - 1
                ) {

                    await openChapter(
                        currentChapterIndex + 1
                    );

                }

            }
        );

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

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "get_book_chapter_metadata",
            {
                p_book_id: currentBook.id
            }
        );

        if (error) {

            console.error(
                "Failed to load chapter list:",
                error
            );

            alert(
                "Failed to load chapters."
            );

            return;
        }

        currentChapters =
            data || [];

        console.log(
            "Loaded chapter metadata:",
            currentChapters
        );

        const chapterList =
            $("chapterList");

        if (!chapterList) {

            console.error(
                "chapterList element not found."
            );

            return;
        }

        chapterList.innerHTML = "";

        currentChapters.forEach(
            (chapter, index) => {

                const item =
                    document.createElement("button");

                item.type =
                    "button";

                item.className =
                    "chapter-item";

                if (
                    index ===
                    currentChapterIndex
                ) {

                    item.classList.add(
                        "active"
                    );

                }

                const isFree =
                    chapter.is_free === true;

                /* Updated: Paid chapters show ₱150 (Full Access) */
                const accessLabel =
                    isFree
                        ? "FREE"
                        : "LOCKED";

                item.innerHTML = `

                    <span class="chapter-number">
                        Chapter ${chapter.chapter_number}
                    </span>

                    <span class="chapter-title">
                        ${escapeHtml(
                            chapter.title || ""
                        )}
                    </span>

                    <span
                        class="chapter-price ${
                            isFree
                                ? "free"
                                : "paid"
                        }"
                    >
                        ${accessLabel}
                    </span>

                `;

                item.addEventListener(
                    "click",
                    async () => {

                        const clickedIndex =
                            currentChapters.findIndex(
                                c =>
                                    c.id ===
                                    chapter.id
                            );

                        if (
                            clickedIndex !== -1
                        ) {

                            await openChapter(
                                clickedIndex
                            );

                        }

                    }
                );

                chapterList.appendChild(
                    item
                );

            }
        );

        updateNavigationButtons();

    } catch (error) {

        console.error(
            "Chapter list error:",
            error
        );

        alert(
            "Something went wrong while loading chapters."
        );
    }
}

/* =========================================================
   OPEN CHAPTER
========================================================= */

async function openChapter(index) {

    if (
        index < 0 ||
        index >= currentChapters.length
    ) {

        return;

    }

    currentChapterIndex =
        index;

    const chapter =
        currentChapters[index];

    currentChapter =
        chapter;

    console.log(
        "Clicked chapter:",
        chapter
    );

    console.log(
        "is_free:",
        chapter.is_free,
        "type:",
        typeof chapter.is_free
    );

    const isFree =
        chapter.is_free === true ||
        chapter.is_free === "true" ||
        chapter.is_free === 1;

    /* =====================================================
       FREE CHAPTER
    ===================================================== */

    if (isFree) {

        await loadChapterContent(
            chapter
        );

        updateChapterSidebar();

        updateNavigationButtons();

        startViewTimer(chapter);

        return;
    }

    /* =====================================================
       PAID CHAPTER
    ===================================================== */

    if (!currentUser) {

        pendingChapter =
            chapter;

        alert(
            "Please log in first to unlock full access."
        );

        openModal(
            "loginModal"
        );

        return;
    }

    /* =====================================================
       CHECK DATABASE PURCHASE
    ===================================================== */

    const unlocked =
        await isChapterUnlocked(
            chapter.id
        );

    if (!unlocked) {

        pendingChapter =
            chapter;

        showPaymentModal(
            chapter
        );

        return;
    }

    /* =====================================================
       PURCHASE EXISTS
    ===================================================== */

    await loadChapterContent(
        chapter
    );

    updateChapterSidebar();

    updateNavigationButtons();

    startViewTimer(chapter);
}

/* =========================================================
   CHECK CHAPTER PURCHASE
   Uses public.purchases
========================================================= */

async function isChapterUnlocked(
    chapterId
) {

    if (!currentUser) {
        return false;
    }

    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("purchases")
            .select(
                "id, payment_status"
            )
            .eq(
                "user_id",
                currentUser.id
            )
            .eq(
                "chapter_id",
                chapterId
            )
            .eq(
                "payment_status",
                "paid"
            )
            .limit(1)
            .maybeSingle();

        if (error) {

            console.error(
                "Purchase check failed:",
                error
            );

            return false;
        }

        return !!data;

    } catch (error) {

        console.error(
            "Purchase check error:",
            error
        );

        return false;
    }
}

/* =========================================================
   LOAD CHAPTER CONTENT
   Uses secure SECURITY DEFINER RPC.
========================================================= */

async function loadChapterContent(
    chapter
) {

    if (!chapter) return;

    try {

        console.log(
            "Loading chapter:",
            chapter.chapter_number
        );

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "get_chapter_for_reader",
            {
                p_chapter_id:
                    chapter.id
            }
        );

        if (error) {

            console.error(
                "Failed to load chapter:",
                error
            );

            alert(
                "Unable to load this chapter."
            );

            return;
        }

        /*
         * If the RPC returns no rows,
         * the chapter is locked.
         */

        if (
            !data ||
            data.length === 0
        ) {

            console.log(
                "Chapter is locked."
            );

            if (!currentUser) {

                pendingChapter =
                    chapter;

                openModal(
                    "loginModal"
                );

                return;

            }

            pendingChapter =
                chapter;

            showPaymentModal(
                chapter
            );

            return;
        }

        const loadedChapter =
            data[0];

        currentChapter =
            loadedChapter;

        console.log(
            "Chapter loaded:",
            loadedChapter.chapter_number
        );

        /* =================================================
           UPDATE READER TITLE
        ================================================= */

        const titleElement =
            $("readerChapterTitle");

        if (titleElement) {

            titleElement.textContent =
                `Chapter ${
                    loadedChapter.chapter_number
                }: ${
                    loadedChapter.title || ""
                }`;

        }

        /* =================================================
           UPDATE CHAPTER HEADING
        ================================================= */

        const heading =
            $("chapterHeading");

        if (heading) {

            heading.textContent =
                `Chapter ${
                    loadedChapter.chapter_number
                }`;

        }

        const numberElement =
            $("readerChapterNumber");

        if (numberElement) {

            numberElement.textContent =
                `Chapter ${
                    loadedChapter.chapter_number
                }`;

        }

        /* =================================================
           UPDATE CONTENT
        ================================================= */

        const contentElement =
            $("readerContent") ||
            $("storyContent");

        if (contentElement) {

            contentElement.innerHTML =
                loadedChapter.content || "";

        }

        /* =================================================
           CATEGORY
        ================================================= */

        const category =
            $("readerCategory");

        if (category) {

            category.textContent =
                currentBook?.genre ||
                "Romance";

        }

        /* =================================================
           PROGRESS
        ================================================= */

        updateReaderProgress(
            loadedChapter.chapter_number
        );

        updateChapterSidebar();

        updateNavigationButtons();

        updateReaderStats(
            currentBook
        );

        /*
         * Save reading progress after successfully
         * opening the chapter.
         */

        await saveReadingProgress(
            loadedChapter
        );

    } catch (error) {

        console.error(
            "Chapter content error:",
            error
        );

        alert(
            "Something went wrong while opening this chapter."
        );
    }
}

/* =========================================================
   LEGACY RENDER CHAPTER
   Kept for compatibility with existing HTML.
========================================================= */

function renderChapter(
    chapter
) {

    if (!chapter) return;

    if ($("readerBookTitle")) {

        $("readerBookTitle").textContent =
            currentBook?.title || "";

    }

    if ($("sidebarBookTitle")) {

        $("sidebarBookTitle").textContent =
            currentBook?.title || "";

    }

    if ($("readerCategory")) {

        $("readerCategory").textContent =
            currentBook?.genre ||
            "Romance";

    }

    if ($("chapterHeading")) {

        $("chapterHeading").textContent =
            `Chapter ${chapter.chapter_number}`;

    }

    if ($("readerChapterTitle")) {

        $("readerChapterTitle").textContent =
            chapter.title ||
            `Chapter ${chapter.chapter_number}`;

    }

    if ($("readerChapterNumber")) {

        $("readerChapterNumber").textContent =
            `Chapter ${chapter.chapter_number}`;

    }

    const contentElement =
        $("readerContent") ||
        $("storyContent");

    if (contentElement) {

        contentElement.innerHTML =
            chapter.content || "";

    }

    updateReaderProgress(
        chapter.chapter_number
    );

    updateNavigationButtons();

    updateReaderStats(
        currentBook
    );
}

/* =========================================================
   UPDATE CHAPTER SIDEBAR
========================================================= */

function updateChapterSidebar() {

    document
        .querySelectorAll(".chapter-item")
        .forEach(
            (button, index) => {

                button.classList.toggle(
                    "active",
                    index ===
                    currentChapterIndex
                );

            }
        );
}

/* =========================================================
   NAVIGATION BUTTONS
========================================================= */

function updateNavigationButtons() {

    const previous =
        $("previousChapter");

    const next =
        $("nextChapter");

    if (previous) {

        previous.disabled =
            currentChapterIndex === 0;

    }

    if (next) {

        next.disabled =
            currentChapterIndex >=
            currentChapters.length - 1;

    }
}

/* =========================================================
   READER PROGRESS
========================================================= */

function updateReaderProgress(
    chapterNumber
) {

    const total =
        currentBook?.total_chapters ||
        currentChapters.length ||
        1;

    const percent =
        Math.round(
            (Number(chapterNumber) /
                total) *
            100
        );

    const progressText =
        $("readerProgressText");

    if (progressText) {

        progressText.textContent =
            `${percent}%`;

    }
}

/* =========================================================
   READING PROGRESS
========================================================= */

async function saveReadingProgress(
    chapter
) {

    if (
        !currentUser ||
        !currentBook ||
        !chapter
    ) {

        if (chapter) {

            updateContinueDisplay(
                chapter.chapter_number
            );

        }

        return;
    }

    const total =
        Number(
            currentBook.total_chapters ||
            49
        );

    const chapterNumber =
        Number(
            chapter.chapter_number
        );

    const percent =
        Math.round(
            (chapterNumber /
                total) *
            100
        );

    try {

        const {
            error
        } = await supabaseClient
            .from("reading_progress")
            .upsert(

                {
                    user_id:
                        currentUser.id,

                    book_id:
                        currentBook.id,

                    chapter_id:
                        chapter.id,

                    chapter_number:
                        chapterNumber,

                    progress_percent:
                        percent,

                    updated_at:
                        new Date().toISOString()
                },

                {
                    onConflict:
                        "user_id,book_id"
                }

            );

        if (error) {

            console.error(
                "Progress save error:",
                error
            );

        }

        updateContinueDisplay(
            chapterNumber,
            currentBook,
            percent
        );

    } catch (error) {

        console.error(
            "Progress error:",
            error
        );
    }
}

/* =========================================================
   LOAD CONTINUE READING
========================================================= */

async function loadContinueReading() {

    if (!currentUser) {

        updateContinueDisplay(
            1,
            books[0] || null
        );

        return;
    }

    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("reading_progress")
            .select(
                "book_id, chapter_id, chapter_number, progress_percent, updated_at"
            )
            .eq(
                "user_id",
                currentUser.id
            )
            .order(
                "updated_at",
                {
                    ascending: false
                }
            )
            .limit(1);

        if (
            error ||
            !data ||
            !data.length
        ) {

            updateContinueDisplay(
                1,
                books[0] || null
            );

            return;
        }

        const progress =
            data[0];

        const book =
            books.find(
                item =>
                    item.id ===
                    progress.book_id
            );

        if (!book) {

            updateContinueDisplay(
                1,
                books[0] || null
            );

            return;
        }

        currentBook =
            book;

        let chapterNumber =
            Number(
                progress.chapter_number ||
                1
            );

        /*
         * If chapter_number wasn't available
         * for an old progress row, try chapter_id.
         */

        if (
            !progress.chapter_number &&
            progress.chapter_id
        ) {

            const {
                data: chapter
            } = await supabaseClient
                .from("chapters")
                .select(
                    "chapter_number"
                )
                .eq(
                    "id",
                    progress.chapter_id
                )
                .maybeSingle();

            if (chapter) {

                chapterNumber =
                    chapter.chapter_number;

            }

        }

        updateContinueDisplay(
            chapterNumber,
            book,
            progress.progress_percent
        );

    } catch (error) {

        console.error(
            "Continue reading failed:",
            error
        );
    }
}

/* =========================================================
   UPDATE CONTINUE DISPLAY
========================================================= */

function updateContinueDisplay(
    chapterNumber = 1,
    book = currentBook,
    savedPercent = null
) {

    const title =
        $("continueTitle");

    const chapter =
        $("continueChapter");

    const percentText =
        $("progressPercent");

    const numbers =
        $("progressNumbers");

    const progressBar =
        $("continueProgress");

    if (title) {

        title.textContent =
            book
                ? book.title
                : "Vengeance Resurrection";

    }

    const total =
        Number(
            book?.total_chapters ||
            49
        );

    const percent =
        savedPercent !== null &&
        savedPercent !== undefined

            ? Number(savedPercent)

            : Math.round(
                ((Number(chapterNumber) - 1) /
                    total) *
                100
            );

    if (chapter) {

        chapter.textContent =
            `Chapter ${chapterNumber}`;

    }

    if (percentText) {

        percentText.textContent =
            `${Math.round(percent)}%`;

    }

    if (numbers) {

        numbers.textContent =
            `${chapterNumber} / ${total}`;

    }

    if (progressBar) {

        progressBar.style.width =
            `${Math.min(
                100,
                Math.max(
                    0,
                    percent
                )
            )}%`;

    }

    const continueButton =
        $("continueButton");

    if (continueButton) {

        continueButton.onclick = () => {

            if (book) {

                openReader(
                    book.id,
                    chapterNumber
                );

            }

        };

    }
}

/* =========================================================
   CONTINUE READING BUTTON
========================================================= */

async function continueReading() {

    if (!books.length) {

        alert(
            "Books are still loading."
        );

        return;
    }

    if (currentUser) {

        await loadContinueReading();

    }

    const book =
        currentBook ||
        books[0];

    if (!book) return;

    /*
     * Try to get saved chapter again.
     */

    let chapterNumber = 1;

    if (currentUser) {

        try {

            const {
                data
            } = await supabaseClient
                .from("reading_progress")
                .select(
                    "chapter_number"
                )
                .eq(
                    "user_id",
                    currentUser.id
                )
                .eq(
                    "book_id",
                    book.id
                )
                .maybeSingle();

            if (data?.chapter_number) {

                chapterNumber =
                    data.chapter_number;

            }

        } catch (error) {

            console.error(
                "Continue lookup error:",
                error
            );

        }

    }

    openReader(
        book.id,
        chapterNumber
    );
}

/* =========================================================
   PAYMENT MODAL
   Updated: ₱150 Full Book Access
========================================================= */

function showPaymentModal(
    chapter
) {

    if (!chapter) return;

    const title =
        $("paymentChapterTitle");

    const amount =
        $("paymentAmount");

    if (title) {

        title.textContent =
            currentBook
                ? `Unlock ${currentBook.title}`
                : "Full Book Access";

    }

    if (amount) {

        amount.textContent = "150";

    }

    openModal(
        "paymentModal"
    );
}

/* =========================================================
   START REAL PAYMENT
========================================================= */

async function startRealPayment() {

    if (!pendingChapter) {

        closeModal(
            "paymentModal"
        );

        return;
    }

    if (!currentUser) {

        closeModal(
            "paymentModal"
        );

        openModal(
            "loginModal"
        );

        return;
    }

    const button =
        $("demoPaymentButton");

    if (!button) {

        console.error(
            "Payment button not found."
        );

        return;
    }

    const originalText =
        button.textContent;

    button.disabled = true;

    button.textContent =
        "Redirecting to payment...";

    try {

        /*
         * IMPORTANT:
         *
         * We use supabase.functions.invoke()
         * instead of manually putting the
         * publishable key into Authorization.
         *
         * The authenticated Supabase session
         * is automatically included.
         */

        const {
            data,
            error
        } = await supabaseClient.functions.invoke(
            "create-payment",
            {
                body: {

                    /*
                     * Only send the chapter ID.
                     *
                     * The Edge Function should determine
                     * the real price (₱150) from the database.
                     */

                    chapterId:
                        pendingChapter.id

                }
            }
        );

        if (error) {

            console.error(
                "Create payment error:",
                error
            );

            alert(
                "Failed to create payment. Please try again."
            );

            button.disabled = false;

            button.textContent =
                originalText;

            return;
        }

        console.log(
            "Payment response:",
            data
        );

        if (
            !data ||
            data.error
        ) {

            console.error(
                data
            );

            alert(
                data?.error ||
                "Failed to create payment. Please try again."
            );

            button.disabled = false;

            button.textContent =
                originalText;

            return;
        }

        if (!data.checkout_url) {

            console.error(
                "No checkout URL returned:",
                data
            );

            alert(
                "Payment checkout URL was not returned."
            );

            button.disabled = false;

            button.textContent =
                originalText;

            return;
        }

        /*
         * Redirect to PayMongo.
         */

        window.location.href =
            data.checkout_url;

    } catch (error) {

        console.error(
            "Payment error:",
            error
        );

        alert(
            "Something went wrong while creating the payment."
        );

        button.disabled = false;

        button.textContent =
            originalText;
    }
}

/* =========================================================
   HANDLE PAYMENT RETURN
========================================================= */

async function handlePaymentReturn() {

    const urlParams =
        new URLSearchParams(
            window.location.search
        );

    const paymentStatus =
        urlParams.get(
            "payment"
        );

    const chapterId =
        urlParams.get(
            "chapter"
        );

    if (
        paymentStatus === "success"
    ) {

        /*
         * IMPORTANT:
         *
         * DO NOT unlock with localStorage.
         *
         * The webhook must mark the purchase
         * as "paid" in Supabase.
         */

        alert(
            "Payment completed. Your full access is being verified."
        );

        /*
         * Remove payment parameters.
         */

        window.history.replaceState(
            {},
            document.title,
            window.location.pathname
        );

        /*
         * Save chapter ID temporarily in sessionStorage
         * only for navigation after the redirect.
         *
         * This is NOT an unlock mechanism.
         */

        if (chapterId) {

            sessionStorage.setItem(
                "payment-return-chapter",
                chapterId
            );

        }

        return;
    }

    if (
        paymentStatus === "cancelled"
    ) {

        alert(
            "Payment was cancelled."
        );

        window.history.replaceState(
            {},
            document.title,
            window.location.pathname
        );
    }
}

/* =========================================================
   VIEWS
========================================================= */

function startViewTimer(
    chapter
) {

    if (!chapter) return;

    if (viewTimer) {

        clearTimeout(
            viewTimer
        );

    }

    const key =
        `viewed-chapter-${chapter.id}`;

    if (
        localStorage.getItem(key) ===
        "true"
    ) {

        return;
    }

    viewTimer =
        setTimeout(
            async () => {

                if (
                    currentBook
                ) {

                    await incrementViews(
                        currentBook.id
                    );

                }

                localStorage.setItem(
                    key,
                    "true"
                );

            },
            30000
        );
}

/* =========================================================
   INCREMENT VIEWS
========================================================= */

async function incrementViews(
    bookId
) {

    try {

        const book =
            books.find(
                b =>
                    b.id === bookId
            );

        if (!book) return;

        book.views =
            (Number(book.views) ||
                2000000) +
            1;

        applySort(
            currentSort
        );

        updateReaderStats(
            book
        );

        const {
            error
        } = await supabaseClient
            .from("books")
            .update({
                views:
                    book.views
            })
            .eq(
                "id",
                bookId
            );

        if (error) {

            console.error(
                "View increment error:",
                error
            );

        }

    } catch (err) {

        console.error(
            "Failed to increment views:",
            err
        );
    }
}

/* =========================================================
   VOTE BOOK
========================================================= */

async function voteBook(
    bookId
) {

    const key =
        `voted-book-${bookId}`;

    if (
        localStorage.getItem(key) ===
        "true"
    ) {

        return;
    }

    try {

        const book =
            books.find(
                b =>
                    b.id === bookId
            );

        if (!book) return;

        book.votes =
            (Number(book.votes) ||
                100000) +
            1;

        localStorage.setItem(
            key,
            "true"
        );

        const countEl =
            $("modalVoteCount");

        const btn =
            $("voteButton");

        const btnText =
            $("voteButtonText");

        if (countEl) {

            countEl.textContent =
                Number(
                    book.votes
                ).toLocaleString();

        }

        if (btn) {

            btn.classList.add(
                "voted",
                "just-voted"
            );

            btn.disabled =
                true;

            setTimeout(
                () =>
                    btn.classList.remove(
                        "just-voted"
                    ),
                700
            );

        }

        if (btnText) {

            btnText.textContent =
                "Voted";

        }

        applySort(
            currentSort
        );

        updateReaderStats(
            book
        );

        const {
            error
        } = await supabaseClient
            .from("books")
            .update({
                votes:
                    book.votes
            })
            .eq(
                "id",
                bookId
            );

        if (error) {

            console.error(
                "Vote error:",
                error
            );

        }

    } catch (err) {

        console.error(
            "Failed to vote:",
            err
        );
    }
}

/* =========================================================
   GENRES
========================================================= */

function setupGenreButtons() {

    document
        .querySelectorAll(".genre-card")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const genre =
                        button.dataset.genre;

                    filterBooksByGenre(
                        genre
                    );

                }
            );

        });
}

function filterBooksByGenre(
    genre
) {

    const filtered =
        books.filter(
            book =>
                (
                    book.genre ||
                    ""
                )
                .toLowerCase()
                .includes(
                    genre.toLowerCase()
                )
        );

    if (!filtered.length) {

        const booksGrid =
            $("booksGrid");

        if (booksGrid) {

            booksGrid.innerHTML = `

                <div class="empty-message">

                    No ${
                        escapeHtml(
                            genre
                        )
                    }
                    books found yet.

                </div>

            `;

        }

        return;
    }

    renderBooks(
        filtered
    );
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }

    return String(value)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );
}
/* =========================================================
   SEARCH BOOKS
========================================================= */

function setupBookSearch() {
    const searchInput = $("bookSearch");

    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();

        if (!query) {
            applySort(currentSort);
            return;
        }

        const filtered = books.filter(book => {
            const title = (book.title || "").toLowerCase();
            const author = (book.author || "").toLowerCase();
            const genre = (book.genre || "").toLowerCase();
            const description = (book.description || "").toLowerCase();

            return (
                title.includes(query) ||
                author.includes(query) ||
                genre.includes(query) ||
                description.includes(query)
            );
        });

        renderBooks(filtered);
    });
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
                toggleBtn.textContent = layout.classList.contains("sidebar-hidden")
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