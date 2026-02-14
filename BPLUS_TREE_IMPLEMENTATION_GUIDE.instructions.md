
# B+ Tree Implementation Guide
### A Comprehensive Guide to Building a Thread-Safe B+ Tree Index

---


---

## 1. Introduction

### 1.1 What is a B+ Tree?

A B+ Tree is a self-balancing tree data structure that maintains sorted data and allows for efficient insertion, deletion, and search operations. Unlike binary search trees, B+ Trees are optimized for systems that read and write large blocks of data, making them ideal for database systems and file systems.

**Key Characteristics:**

- **Balanced**: All leaf nodes are at the same depth
- **Multi-way**: Each node can have multiple children (not just 2)
- **Sorted**: Keys are maintained in sorted order
- **Dense Index**: All data resides in leaf nodes
- **Sequential Access**: Leaf nodes are linked for efficient range queries

### 1.2 Why B+ Trees for Databases?

Traditional binary search trees have several limitations when used in database systems:

1. **Height Problem**: With millions of records, binary trees become very deep, requiring many disk I/O operations
2. **Poor Disk Utilization**: Each node stores only one key, wasting disk block space
3. **No Sequential Access**: Range queries require tree traversal

B+ Trees solve these problems:

- **Shallow Height**: Wide nodes (hundreds of keys) keep tree shallow (typically 3-4 levels for millions of records)
- **Disk-Friendly**: Node size matches disk block size (typically 4KB)
- **Fast Range Queries**: Linked leaf nodes enable efficient scanning
- **High Fanout**: More children per node means fewer disk I/O operations

### 1.3 Project Overview

This project implements a **thread-safe B+ Tree index** for a database management system. The implementation must:

- Support concurrent operations (multiple threads inserting/deleting/searching simultaneously)
- Use a Buffer Pool Manager for page management (no direct memory allocation)
- Implement proper latch coupling (crabbing) for thread safety
- Handle dynamic structure changes (splits and merges)
- Provide iterator support for range queries
- Maintain ACID properties (specifically Isolation through proper locking)

**Constraints:**

- Only unique keys (no duplicate keys allowed)
- All pages accessed through Buffer Pool Manager
- No global locks (must support reasonable concurrency)
- Binary search required for efficiency
- Pages must be at least half full (except root)

### 1.4 Document Structure

This guide is organized into progressive sections:

- **Sections 2-3**: Architecture and file organization
- **Sections 4-6**: Task-by-task implementation details
- **Sections 7-8**: Concurrency control deep dive
- **Sections 9-11**: Practical considerations and testing
- **Sections 12-13**: Reference materials and summaries

---

## 2. High-Level Architecture & Concepts

### 2.1 B+ Tree Structure

A B+ Tree consists of three types of components:

#### 2.1.1 Internal Nodes (Index Nodes)

Internal nodes serve as a routing directory, guiding searches to the correct child node.

**Structure:**
```
Internal Node (m keys, m+1 pointers):
┌────────────────────────────────────────────────────┐
│ P₀ | K₁ | P₁ | K₂ | P₂ | ... | Kₘ | Pₘ             │
└────────────────────────────────────────────────────┘
```

- **Pointers (P)**: References to child pages (page IDs)
- **Keys (K)**: Separator values that partition the key space
- **Invariant**: All keys in subtree Pᵢ satisfy: Kᵢ ≤ key < Kᵢ₊₁

**Important**: The first key (K₀) is typically invalid/unused. Searches start from K₁.

#### 2.1.2 Leaf Nodes (Data Nodes)

Leaf nodes store the actual data entries.

**Structure:**
```
Leaf Node (n key-value pairs):
┌────────────────────────────────────────────────────┐
│ K₁:V₁ | K₂:V₂ | K₃:V₃ | ... | Kₙ:Vₙ | next_ptr     │
└────────────────────────────────────────────────────┘
```

- **Keys (K)**: Search keys in sorted order
- **Values (V)**: Record identifiers (RIDs) pointing to actual data
- **Next Pointer**: Links to the next leaf node (for range queries)

#### 2.1.3 Header Page

A special page that stores metadata about the tree.

**Contents:**
- **Root Page ID**: Current root page identifier
- Protected by latches to prevent race conditions during root changes

### 2.2 B+ Tree Properties

#### 2.2.1 Structural Properties

1. **Balanced**: All leaf nodes are at the same depth
2. **Ordered**: Keys within each node are sorted
3. **Dense Index**: All data pointers are in leaf nodes
4. **High Fanout**: Each node contains many keys (typically hundreds)

#### 2.2.2 Capacity Constraints

For a node with maximum capacity M:

- **Minimum Keys** (except root): ⌈M/2⌉ keys
- **Maximum Keys**: M keys
- **Root Exception**: Root can have 1 to M keys

**Example** (M = 5):
- Internal nodes: 3-5 keys (except root: 1-5)
- Leaf nodes: 3-5 key-value pairs (except root: 1-5)

#### 2.2.3 Height Analysis

For N keys and minimum fanout d:

- **Minimum Height**: log_M(N)
- **Maximum Height**: log_d(N) where d = ⌈M/2⌉
- **Typical**: 3-4 levels for millions of records (with M ≈ 200)

**Example**:
```
M = 100 (typical for 4KB pages)
N = 1,000,000 records
Height ≈ log₁₀₀(1,000,000) = 3 levels
```

### 2.3 Page-Based Storage Architecture

#### 2.3.1 Why Pages?

Database systems organize data into fixed-size blocks called **pages** (typically 4KB or 8KB):

1. **Disk I/O Efficiency**: Operating systems read/write data in blocks
2. **Buffer Pool Management**: Pages are the unit of caching in memory
3. **Concurrency Control**: Latching operates at page granularity
4. **Alignment**: Matches OS page size for optimal performance

#### 2.3.2 Page Layout

Each page has a fixed size (e.g., 4096 bytes) and contains:

**Generic Page Structure:**
```
┌──────────────────────────────────────────────┐
│ Page Header (metadata)           │ 12-20 B  │
├──────────────────────────────────────────────┤
│ Key Array                         │ Variable │
├──────────────────────────────────────────────┤
│ Value Array                       │ Variable │
├──────────────────────────────────────────────┤
│ Additional Data (if needed)       │ Variable │
└──────────────────────────────────────────────┘
```

**Page Header Contains:**
- Page type (internal or leaf)
- Current size (number of entries)
- Maximum size (capacity)
- Additional metadata (e.g., next page pointer for leaves)

#### 2.3.3 Page Capacity Calculation

The number of entries per page depends on key and value sizes:

```
Capacity = (PAGE_SIZE - HEADER_SIZE) / (sizeof(Key) + sizeof(Value))
```

**Example**:
```
PAGE_SIZE = 4096 bytes
HEADER_SIZE = 20 bytes
sizeof(Key) = 8 bytes (GenericKey<8>)
sizeof(Value) = 8 bytes (RID)

Capacity = (4096 - 20) / (8 + 8) = 254 entries per page
```

### 2.4 Buffer Pool Manager Integration

#### 2.4.1 What is the Buffer Pool Manager?

The Buffer Pool Manager (BPM) is a memory cache that sits between the B+ Tree and disk storage:

```
┌─────────────────┐
│   B+ Tree       │  (Index operations)
└────────┬────────┘
         │
┌────────▼────────┐
│  Buffer Pool    │  (Page caching & pinning)
│  Manager        │
└────────┬────────┘
         │
┌────────▼────────┐
│  Disk Manager   │  (Physical I/O)
└─────────────────┘
```

**BPM Responsibilities:**
- Cache frequently accessed pages in memory
- Fetch pages from disk when not in cache
- Write dirty pages back to disk
- Implement page replacement policy (e.g., LRU-K)
- Track page pin counts (prevent eviction of in-use pages)

#### 2.4.2 Page Access Pattern

**CRITICAL RULE**: Never directly allocate B+ Tree nodes on heap or stack. Always use the Buffer Pool Manager.

**Correct Pattern:**
```cpp
// Fetch an existing page
page_id_t page_id = GetChildPageId();
auto guard = bpm->WritePage(page_id);
auto page = guard.AsMut<BPlusTreeLeafPage>();

// Use the page
page->Insert(key, value, comparator);

// Guard automatically unpins and unlatches when it goes out of scope
```

**Wrong Pattern (NEVER DO THIS):**
```cpp
// WRONG: Direct heap allocation
auto page = new BPlusTreeLeafPage();  // NO!

// WRONG: Stack allocation
BPlusTreeLeafPage page;  // NO!
```

#### 2.4.3 Page Operations

**Fetching Pages:**
- `NewPage()`: Allocate a new page, returns page_id
- `FetchPage(page_id)`: Get existing page (internal, use guards instead)
- `DeletePage(page_id)`: Mark page as deleted (return to free list)

**Pin/Unpin Mechanism:**
- **Pinning**: Increment reference count (prevents eviction)
- **Unpinning**: Decrement reference count (allows eviction)
- **Automatic**: Page guards handle pinning/unpinning via RAII

### 2.5 RAII Page Guards

#### 2.5.1 What are Page Guards?

Page guards are RAII (Resource Acquisition Is Initialization) wrapper objects that combine:
1. **Page Access**: Pointer to the page data
2. **Latching**: Automatic lock acquisition and release
3. **Pinning**: Automatic pin/unpin on construction/destruction

**Benefits:**
- Exception-safe (automatic cleanup)
- No manual lock/unlock needed
- Prevents deadlocks from forgotten unlocks
- Prevents use-after-free bugs

#### 2.5.2 ReadPageGuard

Used for read-only access (shared lock):

```cpp
// Multiple threads can hold read guards simultaneously
ReadPageGuard guard = bpm->ReadPage(page_id);
auto page = guard.As<BPlusTreeLeafPage>();  // const access

// Read operations
bool found = page->Lookup(key, &result, comparator);

// Guard automatically releases read latch and unpins on destruction
```

**Properties:**
- Multiple readers allowed concurrently
- No writers allowed while readers exist
- Use for: search operations, tree traversal during reads

#### 2.5.3 WritePageGuard

Used for exclusive write access:

```cpp
// Only one thread can hold write guard on a page
WritePageGuard guard = bpm->WritePage(page_id);
auto page = guard.AsMut<BPlusTreeLeafPage>();  // mutable access

// Modify the page
page->Insert(key, value, comparator);

// Guard automatically releases write latch and unpins on destruction
```

**Properties:**
- Exclusive access (no other readers or writers)
- Can read and write
- Use for: insert, delete, splits, merges

#### 2.5.4 Guard Operations

**Access Methods:**
```cpp
// Read guard (const access)
ReadPageGuard read_guard = bpm->ReadPage(page_id);
auto const_page = read_guard.As<PageType>();

// Write guard (mutable access)
WritePageGuard write_guard = bpm->WritePage(page_id);
auto mut_page = write_guard.AsMut<PageType>();
```

**Manual Control:**
```cpp
// Get page ID
page_id_t id = guard.GetPageId();

// Explicit release (before natural destruction)
guard.Drop();

// After Drop(), guard is invalid
```

**Move Semantics:**
```cpp
// Guards can be moved but not copied
WritePageGuard guard1 = bpm->WritePage(page_id);
WritePageGuard guard2 = std::move(guard1);  // OK
// guard1 is now invalid, guard2 owns the resource
```

### 2.6 Tree Structure Example

Let's visualize a small B+ Tree (max 3 keys per node):

```
                    [10 | 20]
                   /    |     \
                  /     |      \
                 /      |       \
        ┌───────┘    ┌──┘        └────────┐
        │            │                    │
    [5 | 8]      [10 | 15]           [20 | 25]
    /  |  \      /   |   \           /   |   \
   /   |   \    /    |    \         /    |    \
[1:R1] [5:R2] [10:R3] [15:R4]  [20:R5] [25:R6]
[3:R7] [8:R8] [12:R9] [18:R10] [23:R11] [30:R12]
  │      │       │       │         │        │
  └──────┴───────┴───────┴─────────┴────────┘
         (Leaf nodes linked for scanning)
```

**Explanation:**
- **Root** (internal): Contains keys [10, 20] and 3 child pointers
- **Internal Level**: Two internal nodes partition the key space
- **Leaf Level**: Six leaf nodes contain actual data (key:RID pairs)
- **Links**: Arrows between leaves enable sequential scanning

### 2.7 Key Concepts Summary

Before diving into implementation, understand these core concepts:

1. **Pages are the unit of storage**: Everything is organized into fixed-size pages
2. **Buffer Pool manages pages**: Never allocate pages directly
3. **Guards provide RAII safety**: Automatic latching and pinning
4. **Internal nodes route**: They only guide searches
5. **Leaf nodes store data**: All actual data is in leaves
6. **Concurrency via latching**: Page-level locking for thread safety
7. **Structure changes dynamically**: Splits and merges keep tree balanced

---

## 3. File Organization

### 3.1 Implementation Files Overview

The B+ Tree implementation spans **10 files** organized into 3 categories:

1. **Page Classes** (Task 1): 6 files
2. **B+ Tree Operations** (Task 2): 2 files
3. **Iterator** (Task 3): 2 files

### 3.2 Task 1: Page Classes

#### 3.2.1 B+ Tree Base Page

**Header File:** `src/include/storage/page/b_plus_tree_page.h`

**Implementation:** `src/storage/page/b_plus_tree_page.cpp`

**Purpose:** Base class inherited by both internal and leaf pages

**What to Implement:**
- `IsLeafPage()`: Check if page is leaf type
- `SetPageType()`: Set page type (INVALID/LEAF/INTERNAL)
- `GetSize()`: Get current number of entries
- `SetSize()`: Set current number of entries
- `ChangeSizeBy()`: Increment/decrement size
- `GetMaxSize()`: Get maximum capacity
- `SetMaxSize()`: Set maximum capacity
- `GetMinSize()`: Get minimum required entries (max_size / 2)

**Data Members (12 bytes):**
```cpp
IndexPageType page_type_;  // 4 bytes: LEAF_PAGE or INTERNAL_PAGE
int size_;                 // 4 bytes: Current number of entries
int max_size_;             // 4 bytes: Maximum capacity
```

**Key Constraints:**
- Only add trivially-constructed type fields (int, page_id_t, etc.)
- Do NOT add vectors or complex objects
- Do NOT modify key/value arrays in child classes

#### 3.2.2 B+ Tree Internal Page

**Header File:** `src/include/storage/page/b_plus_tree_internal_page.h`

**Implementation:** `src/storage/page/b_plus_tree_internal_page.cpp`

**Purpose:** Internal nodes that route searches to children

**What to Implement:**

**Initialization:**
- `Init(max_size)`: Initialize internal page

**Basic Access:**
- `KeyAt(index)`: Get key at index
- `SetKeyAt(index, key)`: Set key at index
- `ValueAt(index)`: Get page_id (pointer) at index
- `SetValueAt(index, value)`: Set page_id at index
- `ValueIndex(value)`: Find index of given page_id

**Search:**
- `Lookup(key, comparator)`: Binary search for child page_id

**Modification:**
- `InsertNodeAfter(old_value, new_key, new_value)`: Insert key-value after existing value
- `InsertAt(index, key, value)`: Insert at specific index
- `Remove(index)`: Remove entry at index
- `RemoveAndReturnOnlyChild()`: Return child when root has one child

**Split/Merge/Redistribute:**
- `MoveHalfTo(recipient)`: Move half of entries to new page
- `MoveAllTo(recipient, middle_key, bpm)`: Move all entries during merge
- `MoveFirstToEndOf(recipient, middle_key, bpm)`: Redistribute (move first entry to sibling's end)
- `MoveLastToFrontOf(recipient, middle_key, bpm)`: Redistribute (move last entry to sibling's front)

**Page Layout:**
```
Header (12 bytes):
─────────────────────────────────────────
| PageType | Size | MaxSize |
─────────────────────────────────────────

Key Array:
─────────────────────────────────────────
| INVALID | K₁ | K₂ | ... | Kₙ |
─────────────────────────────────────────

Value Array (page_id_t):
─────────────────────────────────────────
| P₀ | P₁ | P₂ | ... | Pₙ |
─────────────────────────────────────────
```

**Critical Notes:**
- First key (index 0) is INVALID - never used in comparisons
- Number of keys = number of values (not keys + 1)
- Lookup starts from index 1

#### 3.2.3 B+ Tree Leaf Page

**Header File:** `src/include/storage/page/b_plus_tree_leaf_page.h`

**Implementation:** `src/storage/page/b_plus_tree_leaf_page.cpp`

**Purpose:** Leaf nodes that store actual data (key-RID pairs)

**What to Implement:**

**Initialization:**
- `Init(max_size)`: Initialize leaf page

**Basic Access:**
- `GetNextPageId()`: Get right sibling page_id
- `SetNextPageId(page_id)`: Set right sibling page_id
- `KeyAt(index)`: Get key at index
- `ValueAt(index)`: Get RID (value) at index

**Search:**
- `LowerBound(key, comparator)`: Binary search for first key >= input
- `Lookup(key, result, comparator)`: Search for key, return value if found

**Modification:**
- `Insert(key, value, comparator)`: Insert key-value pair in sorted order
- `RemoveAt(index)`: Remove entry at index

**Split/Merge/Redistribute:**
- `MoveHalfTo(recipient)`: Move half of entries to new page
- `MoveAllTo(recipient)`: Move all entries during merge
- `MoveFirstToEndOf(recipient)`: Redistribute (move first entry to sibling's end)
- `MoveLastToFrontOf(recipient)`: Redistribute (move last entry to sibling's front)

**Page Layout (Standard Version - No Tombstones):**
```
Header (16 bytes):
─────────────────────────────────────────
| PageType | Size | MaxSize | NextPageId |
─────────────────────────────────────────
    4B        4B      4B         4B

Key Array:
─────────────────────────────────────────
| K₁ | K₂ | K₃ | ... | Kₙ |
─────────────────────────────────────────

Value Array (RID = Record ID):
─────────────────────────────────────────
| V₁ | V₂ | V₃ | ... | Vₙ |
─────────────────────────────────────────
```

**Critical Notes:**
- All keys are valid (unlike internal pages)
- Values are RIDs (8-byte record identifiers)
- NextPageId links to right sibling (INVALID_PAGE_ID for rightmost leaf)
- Must maintain sorted order

### 3.3 Task 2: B+ Tree Operations

#### 3.3.1 B+ Tree Main Class

**Header File:** `src/include/storage/index/b_plus_tree.h`

**Implementation:** `src/storage/index/b_plus_tree.cpp`

**Purpose:** Main B+ Tree class implementing insert/delete/search operations

**Template Parameters:**
```cpp
template <typename KeyType, typename ValueType, typename KeyComparator>
```

**Public Methods to Implement:**
- `IsEmpty()`: Check if tree is empty
- `Insert(key, value, txn)`: Insert key-value pair
- `Remove(key, txn)`: Delete key from tree
- `GetValue(key, result, txn)`: Search for key
- `Begin()`: Return iterator to first entry
- `Begin(key)`: Return iterator starting from key
- `End()`: Return end iterator
- `GetRootPageId()`: Return current root page_id

**Private Helper Methods (Recommended):**

**Tree Initialization:**
- `StartNewTree(key, value)`: Create first leaf node as root

**Navigation:**
- `FindLeaf(key, operation, context)`: Navigate to leaf, tracking path

**Split Operations:**
- `SplitLeaf(leaf_page, leaf_guard)`: Split full leaf page
- `SplitInternal(internal_page, internal_guard)`: Split full internal page
- `InsertIntoParent(context, left_guard, key, right_guard)`: Insert separator into parent

**Merge/Redistribute:**
- `CoalesceOrRedistribute(node_index, context)`: Handle underflow after deletion
- `Redistribute(parent, index, node_guard, sibling_guard, from_left)`: Borrow from sibling
- `Coalesce(parent, index, node_guard, sibling_guard, from_left)`: Merge with sibling
- `AdjustRoot(context)`: Handle root with single child

**Safety Check:**
- `IsSafeNode(page, operation)`: Check if page won't split/merge

**Context Management:**
- `ReleaseContext(context)`: Release all guards in context

**Data Members:**
```cpp
std::string index_name_;              // Index identifier
BufferPoolManager *bpm_;              // Buffer pool manager reference
KeyComparator comparator_;            // Key comparison function
int leaf_max_size_;                   // Leaf page max capacity
int internal_max_size_;               // Internal page max capacity
page_id_t header_page_id_;            // Header page identifier
```

#### 3.3.2 Context Helper Class

**Location:** Inside `b_plus_tree.h`

**Purpose:** Track pages along traversal path for latch coupling

**Recommended Data Members:**
```cpp
class Context {
  std::optional<WritePageGuard> header_page_;   // Header page guard
  page_id_t root_page_id_;                      // Cached root page ID
  std::deque<WritePageGuard> write_set_;        // Pages being modified
  std::deque<ReadPageGuard> read_set_;          // Pages being read (optional)

  // Helper methods
  bool IsRootPage(page_id_t page_id);
  size_t GuardCount();
  WritePageGuard& GuardAt(size_t idx);
};
```

**Usage Pattern:**
1. Store header page guard when acquiring it
2. Store root page ID
3. Push page guards onto write_set_ as you descend
4. Pop guards from write_set_ when safe to release
5. Parent of current page is at index `write_set_.size() - 2`

### 3.4 Task 3: Iterator

#### 3.4.1 Index Iterator Class

**Header File:** `src/include/storage/index/index_iterator.h`

**Implementation:** `src/storage/index/index_iterator.cpp`

**Purpose:** C++17-style iterator for sequential leaf scanning

**What to Implement:**

**Constructors:**
- Default constructor (creates end iterator)
- `IndexIterator(bpm, guard, index, is_end)`: Position-specific constructor

**Iterator Interface:**
- `IsEnd()`: Check if at end
- `operator*()`: Dereference to get key-value pair
- `operator++()`: Advance to next entry
- `operator==(other)`: Equality comparison
- `operator!=(other)`: Inequality comparison

**Data Members:**
```cpp
BufferPoolManager *bpm_;           // Buffer pool reference
ReadPageGuard guard_;              // Current leaf page guard
int index_;                        // Current position in page
bool is_end_;                      // End iterator flag
```

**Key Behaviors:**
- Use ReadPageGuard (read-only access)
- Follow next_page_id_ to traverse leaves
- Not required to be thread-safe

### 3.5 Read-Only Files (Do NOT Modify)

#### 3.5.1 B+ Tree Header Page

**File:** `src/include/storage/page/b_plus_tree_header_page.h`

**Purpose:** Stores root page ID

**Data Member:**
```cpp
page_id_t root_page_id_;
```

**Usage:**
```cpp
// Access header page
auto header_guard = bpm->WritePage(header_page_id_);
auto header = header_guard.AsMut<BPlusTreeHeaderPage>();

// Read root page ID
page_id_t root_id = header->root_page_id_;

// Update root page ID (after split/merge changes root)
header->root_page_id_ = new_root_id;
```

#### 3.5.2 B+ Tree Index Wrapper

**Files:**
- `src/include/storage/index/b_plus_tree_index.h`
- `src/storage/index/b_plus_tree_index.cpp`

**Purpose:** Wrapper class that adapts B+ Tree to Index interface

**Do NOT modify** - this is used by the test framework

### 3.6 Test Files

#### 3.6.1 Core Test Files

**Insert Test:**
- `test/storage/b_plus_tree_insert_test.cpp`
- Tests: sequential insert, random insert, duplicate handling

**Delete Test:**
- `test/storage/b_plus_tree_delete_test.cpp`
- Tests: sequential delete, random delete, merge/redistribute

**Sequential Scale Test:**
- `test/storage/b_plus_tree_sequential_scale_test.cpp`
- Tests: large-scale sequential operations

**Concurrent Test:**
- `test/storage/b_plus_tree_concurrent_test.cpp`
- Tests: concurrent insert/delete/search

**Contention Test:**
- `test/storage/b_plus_tree_contention_test.cpp`
- Tests: concurrency efficiency (contention ratio must be in [2.5, 3.5])

#### 3.6.2 Testing Commands

```bash
# Build and run individual tests
cd build
make b_plus_tree_insert_test -j$(nproc)
./test/b_plus_tree_insert_test

make b_plus_tree_delete_test -j$(nproc)
./test/b_plus_tree_delete_test

make b_plus_tree_concurrent_test -j$(nproc)
./test/b_plus_tree_concurrent_test

# Run all tests
make check-tests

# Code quality checks
make format                  # Format code
make check-lint             # Check code style
make check-clang-tidy-p2    # Static analysis
```

### 3.7 File Dependency Graph

```
┌─────────────────────────────────────────┐
│       b_plus_tree_page.h/cpp            │  (Base class)
└──────────────┬──────────────────────────┘
               │
         ┌─────┴─────┐
         │           │
┌────────▼───────┐   └──────────────┐
│ internal_page  │   leaf_page.h/cpp│  (Derived classes)
│ .h/cpp         │                  │
└────────┬───────┘                  │
         │                          │
         └──────────┬───────────────┘
                    │
          ┌─────────▼──────────┐
          │  b_plus_tree.h/cpp │  (Uses page classes)
          └─────────┬──────────┘
                    │
          ┌─────────▼──────────┐
          │ index_iterator     │  (Uses B+ Tree)
          │ .h/cpp             │
          └────────────────────┘
```

**Dependency Rules:**
- Base page → Internal/Leaf pages → B+ Tree → Iterator
- Implement in this order to avoid compilation issues
- Each layer depends only on layers above it

### 3.8 Implementation Order Recommendation

**Phase 1: Foundation**
1. Implement `b_plus_tree_page.h/cpp` (base class)
2. Implement basic methods in `b_plus_tree_internal_page.h/cpp`
3. Implement basic methods in `b_plus_tree_leaf_page.h/cpp`
4. Test: Verify pages can be created and initialized

**Phase 2: Simple Operations**
5. Implement simple insert (no splits) in `b_plus_tree.cpp`
6. Implement search in `b_plus_tree.cpp`
7. Test: Insert small number of keys, search for them

**Phase 3: Splits**
8. Implement `SplitLeaf` in both leaf page and b_plus_tree
9. Implement `SplitInternal` in both internal page and b_plus_tree
10. Implement `InsertIntoParent`
11. Test: Insert enough keys to trigger splits

**Phase 4: Deletes**
12. Implement simple delete (no underflow)
13. Implement redistribute operations
14. Implement coalesce/merge operations
15. Test: Delete keys, verify structure

**Phase 5: Iterator**
16. Implement iterator construction and basic operations
17. Implement Begin/End methods in b_plus_tree
18. Test: Iterate through all entries

**Phase 6: Concurrency**
19. Implement latch coupling logic
20. Implement safe node detection
21. Test: Run concurrent tests

---

## 4. Task 1: Page Classes

This section provides detailed implementation guidance for the three page classes that form the foundation of the B+ Tree.

### 4.1 B+ Tree Base Page

#### 4.1.1 Overview

The base page class contains common fields and methods used by both internal and leaf pages. It serves as an abstract base class.

**Key Responsibilities:**
- Store page type (leaf or internal)
- Track current size (number of entries)
- Store maximum capacity
- Provide common accessors

#### 4.1.2 Data Layout

```
Bytes 0-3:   page_type_ (IndexPageType enum)
Bytes 4-7:   size_ (int)
Bytes 8-11:  max_size_ (int)
Total: 12 bytes
```

#### 4.1.3 Implementation Details

**IsLeafPage()**
- Check if `page_type_` equals `IndexPageType::LEAF_PAGE`
- Return boolean result

**SetPageType(IndexPageType page_type)**
- Assign `page_type_` member
- Called during page initialization

**GetSize() / SetSize(int size)**
- Simple getter/setter for `size_` member
- `size_` represents current number of key-value pairs

**ChangeSizeBy(int amount)**
- Increment or decrement `size_` by `amount`
- Useful for: `ChangeSizeBy(1)` after insert, `ChangeSizeBy(-1)` after delete
- Implementation: `size_ += amount;`

**GetMaxSize() / SetMaxSize(int max_size)**
- Simple getter/setter for `max_size_` member
- `max_size_` is the capacity (maximum entries page can hold)

**GetMinSize()**
- Calculate minimum required entries: `(max_size_ + 1) / 2`
- This formula implements ceiling division: ⌈max_size / 2⌉
- Example: max_size = 5 → min_size = 3
- Example: max_size = 6 → min_size = 3
- **Exception**: Root can have any number of entries (1 to max_size)

#### 4.1.4 Constraints

**CRITICAL CONSTRAINTS:**

1. **No Complex Members**: Only add trivially-constructed types (int, page_id_t, etc.)
   - Do NOT add: std::vector, std::string, or any STL container
   - Reason: Pages are cast from raw bytes, complex types won't be properly constructed

2. **Do NOT Modify Child Arrays**: In derived classes, do NOT modify `key_array_` or `value_array_`
   - These arrays are managed by the derived classes
   - Base class should not touch them

3. **No Dynamic Allocation**: Never use new/delete within page methods
   - Pages live in buffer pool, not on heap
   - All memory is pre-allocated by buffer pool manager

### 4.2 B+ Tree Internal Page

#### 4.2.1 Overview

Internal pages serve as routing/index nodes. They store ordered keys and child page pointers to guide searches down the tree.

**Key Characteristics:**
- Stores m keys and m pointers (not m+1)
- First key (index 0) is INVALID and never used
- Actual keys start at index 1
- Each pointer leads to a child subtree

#### 4.2.2 Data Layout

```
┌─────────────────────────────────────────────────────┐
│ Header (12 bytes) - Inherited from Base Page       │
├─────────────────────────────────────────────────────┤
│ Key Array (KeyType keys[INTERNAL_PAGE_SLOT_CNT])   │
│   - Index 0: INVALID (not used)                    │
│   - Index 1 to size-1: Valid separator keys        │
├─────────────────────────────────────────────────────┤
│ Value Array (page_id_t values[INTERNAL_PAGE_SLOT_CNT]) │
│   - Index 0 to size-1: Child page IDs              │
└─────────────────────────────────────────────────────┘
```

**Memory Layout Example:**
```
If sizeof(KeyType) = 8, sizeof(page_id_t) = 4, PAGE_SIZE = 4096:

Capacity = (4096 - 12) / (8 + 4) = 340 entries
```

#### 4.2.3 Key-Value Semantics

**Important**: Unlike traditional B+ Trees, this implementation stores the same number of keys as values:

```
Traditional B+ Tree Internal Node:
  Keys:    [INVALID, 10, 20, 30]
  Pointers: [P0, P1, P2, P3, P4]  (5 pointers for 4 keys)

This Implementation:
  Keys:    [INVALID, 10, 20, 30]  (size = 4)
  Values:  [P0, P1, P2, P3]       (size = 4)
```

**Pointer Semantics:**
- `ValueAt(0)` (P₀): Points to subtree where all keys < `KeyAt(1)`
- `ValueAt(i)` (Pᵢ): Points to subtree where `KeyAt(i)` ≤ keys < `KeyAt(i+1)`
- `ValueAt(size-1)`: Points to subtree where all keys ≥ `KeyAt(size-1)`

#### 4.2.4 Core Methods Implementation

**Init(int max_size)**
```
Purpose: Initialize a new internal page
Steps:
  1. SetPageType(IndexPageType::INTERNAL_PAGE)
  2. SetSize(0)
  3. SetMaxSize(max_size - 1)  // Note: max_size parameter is capacity + 1

Why max_size - 1?
  - Constructor passes internal_max_size + 1
  - We store actual capacity as max_size
  - This allows checking if page is full: size == max_size
```

**KeyAt(int index) / SetKeyAt(int index, KeyType key)**
```
Purpose: Access key at given index
Implementation:
  - Return/set key_array_[index]
  - No bounds checking needed (caller ensures valid index)

Note: Index 0 returns INVALID key (never used in comparisons)
```

**ValueAt(int index) / SetValueAt(int index, page_id_t value)**
```
Purpose: Access child page_id at given index
Implementation:
  - Return/set value_array_[index]
  - Value is always a page_id_t (4 bytes)
```

**ValueIndex(page_id_t value)**
```
Purpose: Find index of a given child page_id
Algorithm:
  for i from 0 to size-1:
    if value_array_[i] == value:
      return i
  return -1  // Not found

Use Case: Find position of child in parent (for splits/merges)
```

#### 4.2.5 Search Operation

**Lookup(KeyType key, KeyComparator comparator)**

This is the most critical method for internal pages - it determines which child to descend into during search.

**Algorithm:**
```
Purpose: Binary search to find child page_id for given key

Pseudocode:
  // Special case: if size is 1, return the only child
  if size == 1:
    return ValueAt(0)

  // Binary search starting from index 1 (skip invalid key at index 0)
  left = 1
  right = size - 1

  while left <= right:
    mid = left + (right - left) / 2

    if comparator(key, KeyAt(mid)) < 0:
      // key < KeyAt(mid), search left half
      right = mid - 1
    else:
      // key >= KeyAt(mid), search right half
      left = mid + 1

  // After loop, right is the largest index where KeyAt(right) <= key
  // Or right = 0 if key < all keys
  return ValueAt(right)

Explanation:
  - We're finding the largest i such that KeyAt(i) <= key
  - This determines which subtree contains key
  - If key < all keys, return ValueAt(0) (leftmost child)
```

**Example:**
```
Keys:   [INVALID, 10, 20, 30]
Values: [P0, P1, P2, P3]

Lookup(5):  Returns P0 (5 < 10)
Lookup(10): Returns P0 (10 <= 10, but P0 covers [*, 10))
Lookup(15): Returns P1 (10 <= 15 < 20)
Lookup(25): Returns P2 (20 <= 25 < 30)
Lookup(35): Returns P3 (30 <= 35)
```

**Implementation Note:**
- Use `std::lower_bound` or `std::upper_bound` for efficient binary search
- Or implement manual binary search as shown above
- **Must use binary search** - linear search will cause timeout on Gradescope

#### 4.2.6 Insertion Methods

**InsertNodeAfter(page_id_t old_value, KeyType new_key, page_id_t new_value)**

Used after a child split to insert the new child into parent.

**Algorithm:**
```
Purpose: Insert (new_key, new_value) after the entry with old_value

Steps:
  1. Find index of old_value using ValueIndex(old_value)
  2. Insert new_key at index + 1
  3. Insert new_value at index + 1
  4. Increment size

Implementation:
  index = ValueIndex(old_value)

  // Shift entries to make space
  for i from size down to index + 2:
    key_array_[i] = key_array_[i-1]
    value_array_[i] = value_array_[i-1]

  // Insert new entry
  key_array_[index + 1] = new_key
  value_array_[index + 1] = new_value

  ChangeSizeBy(1)
```

**InsertAt(int index, KeyType key, page_id_t value)**

Generic insertion at specific index.

**Algorithm:**
```
Purpose: Insert (key, value) at given index

Steps:
  1. Shift entries from index to end rightward
  2. Insert key and value at index
  3. Increment size

Implementation:
  for i from size down to index + 1:
    key_array_[i] = key_array_[i-1]
    value_array_[i] = value_array_[i-1]

  key_array_[index] = key
  value_array_[index] = value

  ChangeSizeBy(1)
```

#### 4.2.7 Deletion Methods

**Remove(int index)**

**Algorithm:**
```
Purpose: Remove entry at given index

Steps:
  1. Shift entries leftward to overwrite removed entry
  2. Decrement size

Implementation:
  for i from index to size - 2:
    key_array_[i] = key_array_[i+1]
    value_array_[i] = value_array_[i+1]

  ChangeSizeBy(-1)
```

**RemoveAndReturnOnlyChild()**

Special method used when root has only one child (tree height decreases).

**Algorithm:**
```
Purpose: Return the only child page_id and invalidate root

Steps:
  1. Assert size == 1 (only one child)
  2. Return ValueAt(0)
  3. Optionally clear the page

Implementation:
  assert(size == 1)
  page_id_t only_child = ValueAt(0)
  SetSize(0)  // Invalidate
  return only_child
```

#### 4.2.8 Split Operation

**MoveHalfTo(BPlusTreeInternalPage *recipient)**

Called when internal page is full and needs to split.

**Algorithm:**
```
Purpose: Move right half of entries to recipient page

Strategy:
  - Split point: middle of the page
  - Left page keeps first half
  - Right page gets second half
  - Return the middle key (becomes separator in parent)

Pseudocode:
  mid_index = size / 2  // Or (size + 1) / 2 depending on strategy

  // Copy right half to recipient
  recipient_index = 0
  for i from mid_index to size - 1:
    recipient->key_array_[recipient_index] = key_array_[i]
    recipient->value_array_[recipient_index] = value_array_[i]
    recipient_index++

  // Update sizes
  count = size - mid_index
  recipient->SetSize(count)
  SetSize(mid_index)

  // Return middle key (key_array_[mid_index]) to parent
```

**Split Strategy Choices:**

**Option A: Move half exactly**
```
Original size: 5 (full)
Split: Left gets 2, Right gets 3
```

**Option B: Move ceil(size/2)**
```
Original size: 5 (full)
Split: Left gets 3, Right gets 2
```

Both are valid. Choose one consistently.

**Note on Middle Key:**
- The key at `mid_index` becomes the separator key inserted into parent
- This key guides searches: left subtree < key, right subtree ≥ key

#### 4.2.9 Merge/Redistribute Operations

**MoveAllTo(BPlusTreeInternalPage *recipient, KeyType middle_key, BufferPoolManager *bpm)**

Merge all entries into recipient (coalesce operation).

**Algorithm:**
```
Purpose: Move all entries from this page to recipient

Parameters:
  - recipient: Sibling page to merge into
  - middle_key: Separator key from parent (between this and recipient)
  - bpm: Buffer pool manager (for fetching child pages if needed)

Steps:
  1. Append all entries to end of recipient
  2. Update recipient size
  3. This page becomes empty (will be deleted)

Pseudocode:
  recipient_size = recipient->GetSize()

  for i from 0 to size - 1:
    recipient->key_array_[recipient_size + i] = key_array_[i]
    recipient->value_array_[recipient_size + i] = value_array_[i]

  recipient->ChangeSizeBy(size)
  SetSize(0)

Note on middle_key:
  - In some implementations, middle_key is inserted between the two pages' entries
  - The exact strategy depends on whether merging with left or right sibling
```

**MoveFirstToEndOf(BPlusTreeInternalPage *recipient, KeyType middle_key, BufferPoolManager *bpm)**

Redistribute: Move first entry to sibling's end (borrow from left sibling).

**Algorithm:**
```
Purpose: Move first entry from this page to end of recipient

Used when: Right sibling has too few entries, borrows from left

Steps:
  1. Append first entry of this page to end of recipient
  2. Remove first entry from this page
  3. Update parent separator key

Pseudocode:
  // Append to recipient
  recipient_size = recipient->GetSize()
  recipient->key_array_[recipient_size] = key_array_[0]
  recipient->value_array_[recipient_size] = value_array_[0]
  recipient->ChangeSizeBy(1)

  // Remove from this page
  Remove(0)

  // Note: Caller must update parent separator key
```

**MoveLastToFrontOf(BPlusTreeInternalPage *recipient, KeyType middle_key, BufferPoolManager *bpm)**

Redistribute: Move last entry to sibling's front (borrow from right sibling).

**Algorithm:**
```
Purpose: Move last entry from this page to front of recipient

Used when: Left sibling has too few entries, borrows from right

Steps:
  1. Insert last entry of this page at beginning of recipient
  2. Remove last entry from this page
  3. Update parent separator key

Pseudocode:
  // Insert at recipient's front
  recipient->InsertAt(0, key_array_[size - 1], value_array_[size - 1])

  // Remove from this page
  ChangeSizeBy(-1)

  // Note: Caller must update parent separator key
```

### 4.3 B+ Tree Leaf Page

#### 4.3.1 Overview

Leaf pages are the data layer of the B+ Tree. They store actual key-value pairs (keys and RIDs) and are linked together for sequential scanning.

**Key Characteristics:**
- All keys are valid (unlike internal pages where first key is invalid)
- Values are RIDs (Record Identifiers), not page_ids
- Linked to right sibling via `next_page_id_`
- Data is stored in sorted order

#### 4.3.2 Data Layout (Standard Version)

```
┌─────────────────────────────────────────────────────┐
│ Header (16 bytes)                                   │
│   - Base header: 12 bytes (type, size, max_size)   │
│   - next_page_id_: 4 bytes                          │
├─────────────────────────────────────────────────────┤
│ Key Array (KeyType keys[LEAF_PAGE_SLOT_CNT])       │
│   - All keys are valid                             │
│   - Stored in sorted order                          │
├─────────────────────────────────────────────────────┤
│ Value Array (RID values[LEAF_PAGE_SLOT_CNT])       │
│   - Each RID is 8 bytes (page_id + slot_num)       │
└─────────────────────────────────────────────────────┘
```

**Capacity Calculation:**
```
PAGE_SIZE = 4096 bytes
HEADER_SIZE = 16 bytes
sizeof(KeyType) = 8 bytes
sizeof(RID) = 8 bytes

Capacity = (4096 - 16) / (8 + 8) = 255 entries
```

#### 4.3.3 Core Methods Implementation

**Init(int max_size)**
```
Purpose: Initialize a new leaf page

Steps:
  1. SetPageType(IndexPageType::LEAF_PAGE)
  2. SetSize(0)
  3. SetMaxSize(max_size - 1)
  4. SetNextPageId(INVALID_PAGE_ID)

Note: Similar to internal page, max_size parameter is capacity + 1
```

**GetNextPageId() / SetNextPageId(page_id_t next_page_id)**
```
Purpose: Access right sibling link

Usage:
  - GetNextPageId(): Returns page_id of right sibling
  - SetNextPageId(): Updates sibling link
  - INVALID_PAGE_ID means no right sibling (rightmost leaf)

Used by:
  - Iterator to traverse leaves left-to-right
  - Split operation to maintain leaf chain
```

**KeyAt(int index) / ValueAt(int index)**
```
Purpose: Access key or value at given index

Implementation:
  - Return key_array_[index] or value_array_[index]
  - Index range: 0 to size-1
  - All entries are valid (unlike internal page where index 0 is invalid)
```

#### 4.3.4 Search Operations

**LowerBound(KeyType key, KeyComparator comparator)**

Binary search for first key >= input key.

**Algorithm:**
```
Purpose: Find insertion point or exact match

Returns: Index of first key >= input key, or size if all keys < input

Pseudocode:
  left = 0
  right = size

  while left < right:
    mid = left + (right - left) / 2

    if comparator(key_array_[mid], key) < 0:
      // key_array_[mid] < key, search right
      left = mid + 1
    else:
      // key_array_[mid] >= key, search left (but keep mid as candidate)
      right = mid

  return left  // First position where key could be inserted

Examples:
  Keys: [5, 10, 15, 20]
  LowerBound(5)  -> 0 (exact match)
  LowerBound(7)  -> 1 (would insert between 5 and 10)
  LowerBound(10) -> 1 (exact match)
  LowerBound(25) -> 4 (would insert at end)
```

**C++ STL Equivalent:**
```cpp
// Can use std::lower_bound
auto it = std::lower_bound(key_array_, key_array_ + size, key,
                          [&](const KeyType &a, const KeyType &b) {
                            return comparator(a, b) < 0;
                          });
return std::distance(key_array_, it);
```

**Lookup(KeyType key, ValueType *result, KeyComparator comparator)**

Search for key and return value if found.

**Algorithm:**
```
Purpose: Point query - find value for given key

Returns: true if found, false otherwise

Pseudocode:
  index = LowerBound(key, comparator)

  // Check if we found exact match
  if index < size AND comparator(key_array_[index], key) == 0:
    *result = value_array_[index]
    return true

  return false  // Key not found

Optimization:
  - Uses LowerBound for O(log n) search
  - Then verifies exact match with one comparison
```

#### 4.3.5 Insertion

**Insert(KeyType key, ValueType value, KeyComparator comparator)**

Insert key-value pair in sorted order.

**Algorithm:**
```
Purpose: Insert new entry maintaining sorted order

Returns: New size after insertion

Pseudocode:
  // Find insertion point
  index = LowerBound(key, comparator)

  // Check for duplicate key
  if index < size AND comparator(key_array_[index], key) == 0:
    // Key already exists - handle based on requirements
    // Option 1: Return current size (no-op)
    // Option 2: Update value (overwrite)
    // For B+ Tree: typically reject duplicates
    return size  // or throw error

  // Shift entries to make space
  for i from size down to index + 1:
    key_array_[i] = key_array_[i-1]
    value_array_[i] = value_array_[i-1]

  // Insert new entry
  key_array_[index] = key
  value_array_[index] = value

  ChangeSizeBy(1)
  return size

Time Complexity: O(log n) search + O(n) shift = O(n)
```

**Handling Full Page:**
- Do NOT check for overflow in Insert method
- Caller (B+ Tree) checks: if size == max_size after insert, trigger split

#### 4.3.6 Deletion

**RemoveAt(int index)**

Remove entry at specific index.

**Algorithm:**
```
Purpose: Delete entry at given index

Steps:
  1. Shift entries leftward to overwrite deleted entry
  2. Decrement size

Pseudocode:
  // Shift entries left
  for i from index to size - 2:
    key_array_[i] = key_array_[i+1]
    value_array_[i] = value_array_[i+1]

  ChangeSizeBy(-1)

Time Complexity: O(n) due to array shift
```

**Alternative: Remove by Key**

If you prefer to have a Remove(key) method:

```cpp
Remove(KeyType key, KeyComparator comparator) {
  index = LowerBound(key, comparator)

  if index < size AND comparator(key_array_[index], key) == 0:
    RemoveAt(index)
    return true

  return false  // Key not found
}
```

#### 4.3.7 Split Operation

**MoveHalfTo(BPlusTreeLeafPage *recipient)**

Split leaf page when full.

**Algorithm:**
```
Purpose: Move right half of entries to new leaf page

Precondition: size == max_size + 1 (one extra entry already inserted)

Steps:
  1. Calculate split point
  2. Copy right half to recipient
  3. Update sizes
  4. Update next_page_id pointers (maintain leaf chain)

Pseudocode:
  // Split point: middle of the page
  mid = size / 2  // Or (size + 1) / 2 for asymmetric split

  // Copy right half to recipient
  recipient_index = 0
  for i from mid to size - 1:
    recipient->key_array_[recipient_index] = key_array_[i]
    recipient->value_array_[recipient_index] = value_array_[i]
    recipient_index++

  // Update sizes
  count = size - mid
  recipient->SetSize(count)
  SetSize(mid)

  // Maintain leaf chain: this -> recipient -> original_next
  recipient->SetNextPageId(GetNextPageId())
  SetNextPageId(recipient_page_id)

Important: Return recipient->KeyAt(0) as separator key for parent
```

**Split Point Strategies:**

**Strategy 1: Even Split**
```
Size = 5 (after inserting into full page of 4)
Split: [0,1] vs [2,3,4]  (2 vs 3)
```

**Strategy 2: Balanced Split**
```
Size = 5
Split: [0,1,2] vs [3,4]  (3 vs 2)
```

Both are valid. Consistency is key.

#### 4.3.8 Merge/Redistribute Operations

**MoveAllTo(BPlusTreeLeafPage *recipient)**

Merge all entries into recipient.

**Algorithm:**
```
Purpose: Coalesce this leaf with sibling

Steps:
  1. Copy all entries to end of recipient
  2. Update recipient size
  3. Update leaf chain (skip this page)
  4. This page will be deleted by caller

Pseudocode:
  recipient_size = recipient->GetSize()

  // Copy all entries
  for i from 0 to size - 1:
    recipient->key_array_[recipient_size + i] = key_array_[i]
    recipient->value_array_[recipient_size + i] = value_array_[i]

  recipient->ChangeSizeBy(size)

  // Update leaf chain: recipient -> this->next
  recipient->SetNextPageId(GetNextPageId())

  SetSize(0)  // Mark as empty
```

**MoveFirstToEndOf(BPlusTreeLeafPage *recipient)**

Redistribute: Move first entry to sibling's end.

**Algorithm:**
```
Purpose: Borrow entry from right sibling to left sibling

Steps:
  1. Append first entry to recipient's end
  2. Remove first entry from this page
  3. Caller updates parent separator key

Pseudocode:
  recipient_size = recipient->GetSize()
  recipient->key_array_[recipient_size] = key_array_[0]
  recipient->value_array_[recipient_size] = value_array_[0]
  recipient->ChangeSizeBy(1)

  RemoveAt(0)

  // Note: Caller must update parent's separator key to this->KeyAt(0)
```

**MoveLastToFrontOf(BPlusTreeLeafPage *recipient)**

Redistribute: Move last entry to sibling's front.

**Algorithm:**
```
Purpose: Borrow entry from left sibling to right sibling

Steps:
  1. Insert last entry at recipient's front
  2. Remove last entry from this page
  3. Caller updates parent separator key

Pseudocode:
  // Make space at recipient's front
  for i from recipient->GetSize() down to 1:
    recipient->key_array_[i] = recipient->key_array_[i-1]
    recipient->value_array_[i] = recipient->value_array_[i-1]

  // Move entry
  recipient->key_array_[0] = key_array_[size - 1]
  recipient->value_array_[0] = value_array_[size - 1]
  recipient->ChangeSizeBy(1)

  ChangeSizeBy(-1)

  // Note: Caller must update parent's separator key to recipient->KeyAt(0)
```

### 4.4 Page Classes Summary

#### 4.4.1 Key Differences Between Internal and Leaf Pages

| Aspect | Internal Page | Leaf Page |
|--------|---------------|-----------|
| **Purpose** | Route searches | Store data |
| **First Key** | INVALID (unused) | Valid |
| **Value Type** | page_id_t (child pointers) | RID (record identifiers) |
| **Sibling Link** | No | Yes (next_page_id_) |
| **All Valid Entries** | No (skip index 0) | Yes |
| **Used By** | Tree navigation | Iterator, actual data access |

#### 4.4.2 Common Pitfalls

1. **Forgetting First Key is Invalid (Internal Page)**
   - Always start binary search from index 1, not 0
   - Lookup should handle size == 1 case specially

2. **Wrong Split Timing**
   - Leaf: Split after inserting (size == max_size + 1)
   - Internal: Split before inserting (size == max_size)
   - Mixing these up causes assertion failures

3. **Not Maintaining Leaf Chain**
   - Always update next_page_id_ during split
   - Update sibling's next_page_id_ during merge
   - Forgetting breaks iterator

4. **Off-by-One Errors**
   - Size represents count, indices are 0 to size-1
   - LowerBound can return size (insert at end)
   - Always validate index bounds in assertions

5. **Not Using Binary Search**
   - Linear search O(n) will timeout on large tests
   - Must use binary search O(log n) in Lookup/LowerBound

#### 4.4.3 Testing Page Classes

Before moving to B+ Tree operations, test page classes in isolation:

**Unit Tests:**
```cpp
// Test internal page
auto page = reinterpret_cast<InternalPage*>(page_data);
page->Init(5);
page->InsertAt(0, 10, page_id_1);
page->InsertAt(1, 20, page_id_2);
assert(page->Lookup(15, cmp) == page_id_1);
assert(page->Lookup(25, cmp) == page_id_2);

// Test leaf page
auto leaf = reinterpret_cast<LeafPage*>(page_data);
leaf->Init(5);
leaf->Insert(10, rid1, cmp);
leaf->Insert(20, rid2, cmp);
RID result;
assert(leaf->Lookup(10, &result, cmp) == true);
assert(result == rid1);
```

**Edge Cases to Test:**
- Empty page operations
- Single entry page
- Full page insertion
- Split with even/odd sizes
- Remove first/last entry
- Binary search with duplicate keys (should not exist, but test behavior)

---

## 5. Task 2: Core B+ Tree Operations

This section covers the main B+ Tree class implementation, including insert, delete, and search operations.

### 5.1 Context Class Design

#### 5.1.1 Purpose

The Context class is a helper structure that tracks the traversal path during tree operations. It enables latch coupling (covered in detail in Section 7) and provides easy access to parent nodes.

#### 5.1.2 Data Members

```cpp
class Context {
 public:
  std::optional<WritePageGuard> header_page_;   // Header page guard
  page_id_t root_page_id_;                      // Cached root page ID
  std::deque<WritePageGuard> write_set_;        // Path of write guards
  std::deque<ReadPageGuard> read_set_;          // Path of read guards (optional)
};
```

**Why std::deque?**
- Efficient push_back/pop_front operations
- Random access to any element (e.g., parent = write_set_[index - 1])
- No reallocation unlike std::vector

#### 5.1.3 Usage Pattern

**Tracking Traversal Path:**
```
Root at write_set_[0]
Level 1 internal at write_set_[1]
Level 2 internal at write_set_[2]
Leaf at write_set_[3]

Parent of write_set_[i] is write_set_[i-1]
```

**Example:**
```
Tree: Root -> Internal1 -> Internal2 -> Leaf

After traversal:
  write_set_[0] = Root guard
  write_set_[1] = Internal1 guard
  write_set_[2] = Internal2 guard
  write_set_[3] = Leaf guard

To access leaf's parent: write_set_[write_set_.size() - 2]
```

#### 5.1.4 Helper Methods

**IsRootPage(page_id_t page_id)**
```cpp
bool IsRootPage(page_id_t page_id) {
  return page_id == root_page_id_;
}
```

**GuardCount()**
```cpp
size_t GuardCount() {
  return write_set_.size();
}
```

**GuardAt(size_t idx)**
```cpp
WritePageGuard& GuardAt(size_t idx) {
  return write_set_[idx];
}
```

### 5.2 Tree Initialization

#### 5.2.1 Empty Tree Check

**IsEmpty()**

**Algorithm:**
```
Purpose: Check if tree has no entries

Steps:
  1. Fetch header page
  2. Check if root_page_id is INVALID_PAGE_ID
  3. Return result

Pseudocode:
  header_guard = bpm->ReadPage(header_page_id_)
  header = header_guard.As<BPlusTreeHeaderPage>()
  return header->root_page_id_ == INVALID_PAGE_ID
```

#### 5.2.2 Starting New Tree

**StartNewTree(key, value, context)**

Called when inserting into empty tree.

**Algorithm:**
```
Purpose: Create first leaf node as root

Steps:
  1. Allocate new page
  2. Initialize as leaf page
  3. Insert first key-value pair
  4. Update header page with new root
  5. Release header latch

Pseudocode:
  // Allocate new leaf page
  root_page_id = bpm->NewPage()
  root_guard = bpm->WritePage(root_page_id)
  root_leaf = root_guard.AsMut<LeafPage>()

  // Initialize and insert
  root_leaf->Init(leaf_max_size_ + 1)
  root_leaf->Insert(key, value, comparator_)

  // Update header
  header = context->header_page_->AsMut<BPlusTreeHeaderPage>()
  header->root_page_id_ = root_page_id
  context->root_page_id_ = root_page_id

  // Release guards
  root_guard.Drop()
  context->header_page_ = std::nullopt  // Release header
```

### 5.3 Navigation

#### 5.3.1 Finding Leaf Node

**FindLeaf(key, operation, context)**

Core navigation method that traverses from root to leaf.

**Algorithm (Without Latch Coupling - Simplified Version):**
```
Purpose: Navigate to leaf page that should contain key

Parameters:
  - key: Search key
  - operation: INSERT or DELETE (for latch coupling logic)
  - context: Stores traversal path

Steps:
  1. Start with root page
  2. While current page is not leaf:
     a. Cast to internal page
     b. Use Lookup to find child page_id
     c. Fetch child page
     d. Add child guard to context
  3. Return (leaf is at context->write_set_.back())

Pseudocode (simplified, no latch coupling):
  // Start with root
  current_page_id = context->root_page_id_
  current_guard = bpm->WritePage(current_page_id)
  context->write_set_.push_back(std::move(current_guard))

  // Descend until leaf
  while true:
    current_guard = context->write_set_.back()
    current_page = current_guard.As<BPlusTreePage>()

    if current_page->IsLeafPage():
      break  // Found leaf

    // Internal page - find child
    internal = reinterpret_cast<InternalPage*>(current_page)
    child_page_id = internal->Lookup(key, comparator_)

    // Fetch child
    child_guard = bpm->WritePage(child_page_id)
    context->write_set_.push_back(std::move(child_guard))

  // Leaf is now at context->write_set_.back()
```

**With Latch Coupling (Covered in Section 7):**
- Check if nodes are "safe" (won't split/merge)
- Release ancestor latches early when safe node found
- This is the optimistic latch coupling protocol

### 5.4 Insert Operation

#### 5.4.1 High-Level Algorithm

**Insert(key, value, transaction)**

**Algorithm:**
```
Purpose: Insert key-value pair into tree

Returns: false if key already exists, true if inserted

High-Level Steps:
  1. Check if tree is empty -> StartNewTree if needed
  2. Navigate to appropriate leaf
  3. Check if key already exists -> return false
  4. Insert into leaf
  5. If leaf overflows -> split leaf and propagate
  6. Release all guards

Pseudocode:
  // Check empty tree
  header_guard = bpm->WritePage(header_page_id_)
  header = header_guard.AsMut<BPlusTreeHeaderPage>()
  root_page_id = header->root_page_id_

  if root_page_id == INVALID_PAGE_ID:
    StartNewTree(key, value, &context)
    return true

  // Setup context
  context.header_page_ = std::move(header_guard)
  context.root_page_id_ = root_page_id

  // Navigate to leaf
  FindLeaf(key, INSERT, &context)

  // Get leaf from context
  leaf_guard = context.write_set_.back()
  leaf = leaf_guard.AsMut<LeafPage>()

  // Check duplicate
  if leaf->Lookup(key, &existing_value, comparator_):
    ReleaseContext(&context)
    return false  // Key exists

  // Insert into leaf
  leaf->Insert(key, value, comparator_)

  // Check if split needed
  if leaf->GetSize() > leaf->GetMaxSize():
    SplitLeaf(leaf, &leaf_guard, &context)

  // Release all guards
  ReleaseContext(&context)
  return true
```

#### 5.4.2 Leaf Split

**SplitLeaf(leaf, leaf_guard, context)**

Called when leaf page overflows after insertion.

**Algorithm:**
```
Purpose: Split full leaf page into two pages

Precondition: leaf->GetSize() == leaf->GetMaxSize() + 1

Steps:
  1. Allocate new leaf page (right sibling)
  2. Initialize new page
  3. Move right half of entries to new page
  4. Update next_page_id pointers (maintain leaf chain)
  5. Get separator key (first key of new page)
  6. Insert separator into parent

Pseudocode:
  // Allocate new page
  new_page_id = bpm->NewPage()
  new_guard = bpm->WritePage(new_page_id)
  new_leaf = new_guard.AsMut<LeafPage>()
  new_leaf->Init(leaf_max_size_ + 1)

  // Update sibling links
  new_leaf->SetNextPageId(leaf->GetNextPageId())
  leaf->SetNextPageId(new_page_id)

  // Move half to new page
  leaf->MoveHalfTo(new_leaf)

  // Get separator key
  separator_key = new_leaf->KeyAt(0)

  // Handle root split vs. non-root split
  if context->IsRootPage(leaf_guard->GetPageId()):
    // Create new root
    CreateNewRoot(separator_key, leaf_guard, &new_guard, context)
  else:
    // Insert into parent
    InsertIntoParent(separator_key, leaf_guard, &new_guard, context)
```

**Key Decision: Split Timing**
- **Recommended**: Split AFTER inserting into leaf
- Leaf becomes size max_size + 1, then split into two balanced pages
- Alternative: Check before insert and split preemptively (more complex)

#### 5.4.3 Internal Node Split

**SplitInternal(internal, internal_guard, context)**

Called when internal page is full and needs to insert another child.

**Algorithm:**
```
Purpose: Split full internal page into two pages

Precondition: internal->GetSize() == internal->GetMaxSize()

Steps:
  1. Allocate new internal page
  2. Move right half to new page
  3. Get middle key (becomes separator in parent)
  4. Insert separator into parent

Pseudocode:
  // Allocate new page
  new_page_id = bpm->NewPage()
  new_guard = bpm->WritePage(new_page_id)
  new_internal = new_guard.AsMut<InternalPage>()
  new_internal->Init(internal_max_size_ + 1)

  // Move half to new page
  middle_key = internal->MoveHalfTo(new_internal)

  // Handle root split vs. non-root split
  if context->IsRootPage(internal_guard->GetPageId()):
    CreateNewRoot(middle_key, internal_guard, &new_guard, context)
  else:
    InsertIntoParent(middle_key, internal_guard, &new_guard, context)
```

**Key Decision: Split Timing**
- **Recommended**: Split BEFORE inserting new child
- Check if internal is full before calling InsertNodeAfter
- This prevents internal node from temporarily exceeding capacity

#### 5.4.4 Inserting into Parent

**InsertIntoParent(separator_key, left_guard, right_guard, context)**

Insert separator key and new child pointer into parent after split.

**Algorithm:**
```
Purpose: Propagate split up the tree

Parameters:
  - separator_key: Key separating left and right children
  - left_guard: Guard for original (left) child
  - right_guard: Guard for new (right) child
  - context: Contains parent in write_set_

Steps:
  1. Get parent from context
  2. Find position of left child in parent
  3. Insert (separator_key, right_child_id) after left child
  4. If parent overflows -> split parent recursively

Pseudocode:
  // Get parent from context
  // Parent is at write_set_[write_set_.size() - 2]
  parent_index = context->write_set_.size() - 2
  parent_guard = context->write_set_[parent_index]
  parent = parent_guard.AsMut<InternalPage>()

  left_page_id = left_guard->GetPageId()
  right_page_id = right_guard->GetPageId()

  // Check if parent will overflow
  if parent->GetSize() == parent->GetMaxSize():
    // Need to split parent first
    SplitInternal(parent, &parent_guard, context)
    // After split, need to re-find which parent contains left child
    // This gets complex - see detailed implementation below

  // Insert into parent
  parent->InsertNodeAfter(left_page_id, separator_key, right_page_id)
```

**Handling Parent Split:**

When parent is full, you must split it before inserting. After split, the left child might be in either the original parent or the new parent. You need to determine which parent to insert into.

**Detailed Algorithm:**
```
if parent->GetSize() == parent->GetMaxSize():
  // Split parent
  middle_key = SplitInternal(parent, &parent_guard, context)

  // Determine which parent contains left child
  if comparator(separator_key, middle_key) < 0:
    // separator_key < middle_key, insert into left parent (original)
    parent->InsertNodeAfter(left_page_id, separator_key, right_page_id)
  else:
    // separator_key >= middle_key, insert into right parent (new)
    new_parent_guard = context->write_set_[parent_index + 1]
    new_parent = new_parent_guard.AsMut<InternalPage>()
    new_parent->InsertNodeAfter(left_page_id, separator_key, right_page_id)
else:
  // Parent has space, direct insert
  parent->InsertNodeAfter(left_page_id, separator_key, right_page_id)
```

#### 5.4.5 Creating New Root

**CreateNewRoot(separator_key, left_guard, right_guard, context)**

Called when root splits, increasing tree height.

**Algorithm:**
```
Purpose: Create new root with two children (old root split into two)

Steps:
  1. Allocate new internal page
  2. Initialize with separator key and two child pointers
  3. Update header page with new root ID

Pseudocode:
  // Allocate new root
  new_root_id = bpm->NewPage()
  new_root_guard = bpm->WritePage(new_root_id)
  new_root = new_root_guard.AsMut<InternalPage>()
  new_root->Init(internal_max_size_ + 1)

  // Setup new root with two children
  left_page_id = left_guard->GetPageId()
  right_page_id = right_guard->GetPageId()

  // Internal page structure: [INVALID, key1] and [ptr0, ptr1]
  new_root->SetKeyAt(0, KeyType{})  // Invalid key
  new_root->SetValueAt(0, left_page_id)
  new_root->SetKeyAt(1, separator_key)
  new_root->SetValueAt(1, right_page_id)
  new_root->SetSize(2)

  // Update header page
  header = context->header_page_->AsMut<BPlusTreeHeaderPage>()
  header->root_page_id_ = new_root_id
  context->root_page_id_ = new_root_id
```

**Important**:
- New root has exactly 2 children after creation
- First key (index 0) is always invalid in internal pages
- Tree height increases by 1

### 5.5 Delete Operation

#### 5.5.1 High-Level Algorithm

**Remove(key, transaction)**

**Algorithm:**
```
Purpose: Delete key from tree

Returns: void (some implementations return bool for success/failure)

High-Level Steps:
  1. Check if tree is empty -> return if empty
  2. Navigate to appropriate leaf
  3. Check if key exists -> return if not found
  4. Remove from leaf
  5. If leaf underflows -> coalesce or redistribute
  6. If root becomes empty -> adjust root
  7. Release all guards

Pseudocode:
  // Check empty tree
  header_guard = bpm->WritePage(header_page_id_)
  header = header_guard.AsMut<BPlusTreeHeaderPage>()
  root_page_id = header->root_page_id_

  if root_page_id == INVALID_PAGE_ID:
    return  // Empty tree

  // Setup context
  context.header_page_ = std::move(header_guard)
  context.root_page_id_ = root_page_id

  // Navigate to leaf
  FindLeaf(key, DELETE, &context)

  // Get leaf from context
  leaf_guard = context.write_set_.back()
  leaf = leaf_guard.AsMut<LeafPage>()

  // Find and remove key
  index = leaf->LowerBound(key, comparator_)
  if index >= leaf->GetSize() OR comparator(leaf->KeyAt(index), key) != 0:
    ReleaseContext(&context)
    return  // Key not found

  leaf->RemoveAt(index)

  // Check if underflow
  if leaf->GetSize() < leaf->GetMinSize():
    if context->IsRootPage(leaf_guard->GetPageId()):
      AdjustRoot(&context)
    else:
      CoalesceOrRedistribute(context.write_set_.size() - 1, &context)

  // Release all guards
  ReleaseContext(&context)
```

#### 5.5.2 Coalesce or Redistribute

**CoalesceOrRedistribute(node_index, context)**

Handle underflow by either borrowing from sibling or merging with sibling.

**Algorithm:**
```
Purpose: Fix underflow condition

Parameters:
  - node_index: Index of underflow node in context->write_set_
  - context: Contains entire path from root

Decision Logic:
  1. Get sibling (prefer left sibling, fallback to right)
  2. Check if sibling can lend entry (size > min_size)
     - Yes -> Redistribute
     - No -> Coalesce (merge)

Pseudocode:
  // Get underflow node
  node_guard = context->write_set_[node_index]
  node = node_guard.As<BPlusTreePage>()

  // Get parent
  parent_guard = context->write_set_[node_index - 1]
  parent = parent_guard.AsMut<InternalPage>()

  // Find node's position in parent
  node_page_id = node_guard.GetPageId()
  node_pos = parent->ValueIndex(node_page_id)

  // Try to get left sibling
  if node_pos > 0:
    sibling_page_id = parent->ValueAt(node_pos - 1)
    sibling_guard = bpm->WritePage(sibling_page_id)
    sibling = sibling_guard.As<BPlusTreePage>()

    if sibling->GetSize() > sibling->GetMinSize():
      // Can borrow from left sibling
      Redistribute(parent, node_pos, &node_guard, &sibling_guard, true, context)
      return
    else:
      // Merge with left sibling
      Coalesce(parent, node_pos, &node_guard, &sibling_guard, true, context)
      return

  // Try right sibling
  if node_pos < parent->GetSize() - 1:
    sibling_page_id = parent->ValueAt(node_pos + 1)
    sibling_guard = bpm->WritePage(sibling_page_id)
    sibling = sibling_guard.As<BPlusTreePage>()

    if sibling->GetSize() > sibling->GetMinSize():
      // Can borrow from right sibling
      Redistribute(parent, node_pos, &node_guard, &sibling_guard, false, context)
      return
    else:
      // Merge with right sibling
      Coalesce(parent, node_pos, &node_guard, &sibling_guard, false, context)
      return
```

#### 5.5.3 Redistribute

**Redistribute(parent, node_pos, node_guard, sibling_guard, from_left, context)**

Borrow entry from sibling to fix underflow.

**Algorithm:**
```
Purpose: Borrow one entry from sibling

Parameters:
  - parent: Parent internal page
  - node_pos: Position of underflow node in parent
  - node_guard: Guard for underflow node
  - sibling_guard: Guard for sibling
  - from_left: true if borrowing from left sibling
  - context: For potential parent underflow

Steps:
  1. Move entry from sibling to node
  2. Update separator key in parent

Pseudocode:

// Borrow from left sibling
if from_left:
  sibling_page = sibling_guard.AsMut<...Page>()
  node_page = node_guard.AsMut<...Page>()

  if node_page->IsLeafPage():
    // Leaf: move last entry of sibling to front of node
    sibling_leaf = reinterpret_cast<LeafPage*>(sibling_page)
    node_leaf = reinterpret_cast<LeafPage*>(node_page)

    sibling_leaf->MoveLastToFrontOf(node_leaf)

    // Update parent separator key
    // Separator is now node's new first key
    parent->SetKeyAt(node_pos, node_leaf->KeyAt(0))
  else:
    // Internal: move last entry of sibling to front of node
    sibling_internal = reinterpret_cast<InternalPage*>(sibling_page)
    node_internal = reinterpret_cast<InternalPage*>(node_page)

    middle_key = parent->KeyAt(node_pos)
    sibling_internal->MoveLastToFrontOf(node_internal, middle_key, bpm_)

    // Update parent separator key
    parent->SetKeyAt(node_pos, node_internal->KeyAt(0))

// Borrow from right sibling
else:
  sibling_page = sibling_guard.AsMut<...Page>()
  node_page = node_guard.AsMut<...Page>()

  if node_page->IsLeafPage():
    // Leaf: move first entry of sibling to end of node
    sibling_leaf = reinterpret_cast<LeafPage*>(sibling_page)
    node_leaf = reinterpret_cast<LeafPage*>(node_page)

    sibling_leaf->MoveFirstToEndOf(node_leaf)

    // Update parent separator key
    // Separator is now sibling's new first key
    parent->SetKeyAt(node_pos + 1, sibling_leaf->KeyAt(0))
  else:
    // Internal: move first entry of sibling to end of node
    sibling_internal = reinterpret_cast<InternalPage*>(sibling_page)
    node_internal = reinterpret_cast<InternalPage*>(node_page)

    middle_key = parent->KeyAt(node_pos + 1)
    sibling_internal->MoveFirstToEndOf(node_internal, middle_key, bpm_)

    // Update parent separator key
    parent->SetKeyAt(node_pos + 1, sibling_internal->KeyAt(0))
```

**Key Points:**
- After borrowing, both nodes should be at least half full
- Parent separator key must be updated
- For leaves: separator = first key of right node
- For internal: involves middle key from parent

#### 5.5.4 Coalesce

**Coalesce(parent, node_pos, node_guard, sibling_guard, merge_with_left, context)**

Merge node with sibling when redistribution not possible.

**Algorithm:**
```
Purpose: Merge two sibling nodes into one

Parameters:
  - parent: Parent internal page
  - node_pos: Position of underflow node in parent
  - node_guard: Guard for underflow node
  - sibling_guard: Guard for sibling
  - merge_with_left: true if merging with left sibling
  - context: For potential parent underflow

Steps:
  1. Move all entries from one node to sibling
  2. Remove separator key from parent
  3. Delete empty node
  4. Check if parent underflows -> recursive call

Pseudocode:

if merge_with_left:
  // Merge node into left sibling
  // After: left_sibling contains all entries, node is deleted

  sibling_page = sibling_guard.AsMut<...Page>()
  node_page = node_guard.AsMut<...Page>()

  if node_page->IsLeafPage():
    node_leaf = reinterpret_cast<LeafPage*>(node_page)
    sibling_leaf = reinterpret_cast<LeafPage*>(sibling_page)

    // Move all from node to sibling
    node_leaf->MoveAllTo(sibling_leaf)
  else:
    node_internal = reinterpret_cast<InternalPage*>(node_page)
    sibling_internal = reinterpret_cast<InternalPage*>(sibling_page)

    middle_key = parent->KeyAt(node_pos)
    node_internal->MoveAllTo(sibling_internal, middle_key, bpm_)

  // Remove separator from parent
  parent->Remove(node_pos)

  // Delete empty node
  node_page_id = node_guard.GetPageId()
  node_guard.Drop()
  bpm_->DeletePage(node_page_id)

else:
  // Merge right sibling into node
  // After: node contains all entries, sibling is deleted

  sibling_page = sibling_guard.AsMut<...Page>()
  node_page = node_guard.AsMut<...Page>()

  if node_page->IsLeafPage():
    node_leaf = reinterpret_cast<LeafPage*>(node_page)
    sibling_leaf = reinterpret_cast<LeafPage*>(sibling_page)

    // Move all from sibling to node
    sibling_leaf->MoveAllTo(node_leaf)
  else:
    node_internal = reinterpret_cast<InternalPage*>(node_page)
    sibling_internal = reinterpret_cast<InternalPage*>(sibling_page)

    middle_key = parent->KeyAt(node_pos + 1)
    sibling_internal->MoveAllTo(node_internal, middle_key, bpm_)

  // Remove separator from parent
  parent->Remove(node_pos + 1)

  // Delete empty sibling
  sibling_page_id = sibling_guard.GetPageId()
  sibling_guard.Drop()
  bpm_->DeletePage(sibling_page_id)

// Check if parent underflows
if parent->GetSize() < parent->GetMinSize():
  parent_index = context->write_set_.size() - 2

  if context->IsRootPage(parent->GetPageId()):
    AdjustRoot(context)
  else:
    CoalesceOrRedistribute(parent_index, context)
```

**Important:**
- After merge, one page is deleted (use DeletePage)
- Parent loses one separator key
- Parent may underflow -> recursive fix
- Must Drop() guard before DeletePage()

#### 5.5.5 Adjust Root

**AdjustRoot(context)**

Handle special case when root underflows.

**Algorithm:**
```
Purpose: Handle root with too few entries

Cases:
  1. Root is leaf with 0 entries -> tree becomes empty
  2. Root is internal with 1 child -> child becomes new root

Pseudocode:
  root_guard = context->write_set_[0]
  root = root_guard.AsMut<BPlusTreePage>()

  if root->IsLeafPage():
    if root->GetSize() == 0:
      // Tree becomes empty
      header = context->header_page_->AsMut<BPlusTreeHeaderPage>()
      header->root_page_id_ = INVALID_PAGE_ID

      old_root_id = root_guard.GetPageId()
      root_guard.Drop()
      bpm_->DeletePage(old_root_id)
  else:
    // Internal root
    if root->GetSize() == 1:
      // Root has only one child -> child becomes new root
      root_internal = reinterpret_cast<InternalPage*>(root)
      new_root_id = root_internal->RemoveAndReturnOnlyChild()

      // Update header
      header = context->header_page_->AsMut<BPlusTreeHeaderPage>()
      header->root_page_id_ = new_root_id
      context->root_page_id_ = new_root_id

      // Delete old root
      old_root_id = root_guard.GetPageId()
      root_guard.Drop()
      bpm_->DeletePage(old_root_id)
```

**Why Root is Special:**
- Root can have fewer than min_size entries
- Root is the only node that can be deleted without merging
- Deleting root decreases tree height

### 5.6 Search Operation

#### 5.6.1 Point Query

**GetValue(key, result, transaction)**

**Algorithm:**
```
Purpose: Search for key and return value

Returns: true if found, false otherwise

Steps:
  1. Check if tree is empty -> return false
  2. Navigate to leaf (without modifying, use read guards)
  3. Search leaf for key
  4. Return result

Pseudocode:
  // Check empty tree
  header_guard = bpm->ReadPage(header_page_id_)
  header = header_guard.As<BPlusTreeHeaderPage>()
  root_page_id = header->root_page_id_

  if root_page_id == INVALID_PAGE_ID:
    return false  // Empty tree

  // Navigate to leaf using read guards
  current_page_id = root_page_id
  current_guard = bpm->ReadPage(current_page_id)

  while true:
    current_page = current_guard.As<BPlusTreePage>()

    if current_page->IsLeafPage():
      break

    // Internal page
    internal = reinterpret_cast<const InternalPage*>(current_page)
    child_page_id = internal->Lookup(key, comparator_)

    // Move to child (release parent)
    current_guard = bpm->ReadPage(child_page_id)

  // Search leaf
  leaf = reinterpret_cast<const LeafPage*>(current_page)
  found = leaf->Lookup(key, result, comparator_)

  return found
```

**Key Points:**
- Use ReadPageGuard (not WritePageGuard) for read-only operation
- Allows multiple concurrent readers
- No need to track path in context
- Release parent guard before fetching child (no need to hold path)

#### 5.6.2 Range Query Support

Range queries are implemented via the iterator (covered in Section 6).

**Begin()**
```
Purpose: Return iterator to first entry in tree

Steps:
  1. Navigate to leftmost leaf
  2. Create iterator at position 0

Pseudocode:
  if IsEmpty():
    return End()  // End iterator

  // Navigate to leftmost leaf
  current_page_id = root_page_id
  current_guard = bpm->ReadPage(current_page_id)

  while not leaf:
    internal = ...
    leftmost_child_id = internal->ValueAt(0)
    current_guard = bpm->ReadPage(leftmost_child_id)

  // Create iterator at beginning of leftmost leaf
  return IndexIterator(bpm_, std::move(current_guard), 0, false)
```

**Begin(key)**
```
Purpose: Return iterator starting from first key >= input key

Steps:
  1. Navigate to leaf containing key
  2. Use LowerBound to find position
  3. Create iterator at that position

Pseudocode:
  if IsEmpty():
    return End()

  // Navigate to leaf
  leaf_guard = FindLeafForRead(key)
  leaf = leaf_guard.As<LeafPage>()

  // Find position
  index = leaf->LowerBound(key, comparator_)

  if index >= leaf->GetSize():
    // Key is past end of this leaf, might be in next leaf
    // Handle next leaf navigation...

  return IndexIterator(bpm_, std::move(leaf_guard), index, false)
```

### 5.7 Helper Methods

#### 5.7.1 Safe Node Check

**IsSafeNode(page, operation)**

Determine if page won't split/merge during operation (for latch coupling).

**Algorithm:**
```
Purpose: Check if page is "safe" for operation

Safe Conditions:
  - Insert: Won't split (size < max_size)
  - Delete: Won't merge (size > min_size)

Pseudocode:
  if operation == INSERT:
    return page->GetSize() < page->GetMaxSize()

  if operation == DELETE:
    if page->IsLeafPage():
      return page->GetSize() > page->GetMinSize()
    else:
      return page->GetSize() > page->GetMinSize()

  return false
```

**Usage:**
- During traversal, check each node
- If safe, can release ancestor latches (optimistic latch coupling)
- If not safe, must hold entire path (pessimistic)

#### 5.7.2 Release Context

**ReleaseContext(context)**

Release all guards held in context.

**Algorithm:**
```
Purpose: Clean up all latches

Steps:
  1. Drop header page guard if held
  2. Drop all guards in write_set_
  3. Clear write_set_

Pseudocode:
  // Release header
  context->header_page_ = std::nullopt

  // Release all pages in path
  while !context->write_set_.empty():
    context->write_set_.pop_front()

  // Guards automatically released via RAII
```

**Important:**
- Called at end of every operation
- Guards automatically unlatch and unpin on destruction
- Always release in FIFO order (front to back)

### 5.8 Common Implementation Issues

#### 5.8.1 Root Changes

**Problem:** Root page ID changes during splits/merges

**Solution:**
- Always acquire header page guard at operation start
- Update header->root_page_id_ when root changes
- Hold header guard until operation completes or safe node found

#### 5.8.2 Parent Access

**Problem:** Need to access parent during split/merge

**Solution:**
- Use Context to track entire path
- Parent is always at `write_set_[current_index - 1]`
- Use assertions to verify path consistency

#### 5.8.3 Guard Lifetime

**Problem:** Use-after-Drop() errors

**Solution:**
- Never access page after calling Drop()
- Use std::move() when transferring ownership
- Let guards auto-destruct at scope end when possible

#### 5.8.4 Recursive Splits/Merges

**Problem:** Split/merge can propagate up multiple levels

**Solution:**
- InsertIntoParent checks if parent is full
- Recursively splits parent before inserting
- CoalesceOrRedistribute checks parent after merge
- Recursively fixes parent underflow

#### 5.8.5 Buffer Pool Errors

**Problem:** Running out of pages during operations

**Solution:**
- Check NewPage() return value
- Handle allocation failures gracefully
- In practice, tree operations rarely fail if buffer pool is sized correctly

### 5.9 Testing Insert and Delete

#### 5.9.1 Insert Test Cases

**Basic:**
- Insert into empty tree
- Insert single key
- Insert multiple keys in sorted order
- Insert multiple keys in random order

**Splits:**
- Insert until leaf splits
- Insert until multiple levels split
- Insert causing root split

**Edge Cases:**
- Insert duplicate key (should fail)
- Insert into full tree causing cascading splits
- Insert causing unbalanced tree (test rebalancing)

#### 5.9.2 Delete Test Cases

**Basic:**
- Delete from leaf with extra entries
- Delete non-existent key
- Delete all keys (tree becomes empty)

**Redistribute:**
- Delete causing redistribution from left sibling
- Delete causing redistribution from right sibling

**Coalesce:**
- Delete causing merge with left sibling
- Delete causing merge with right sibling
- Delete causing cascading merges
- Delete causing root adjustment (tree height decrease)

**Edge Cases:**
- Delete from tree with single key
- Delete causing root to become leaf
- Interleaved insert/delete operations

---

## 6. Task 3: Index Iterator

This section covers the implementation of a C++17-style iterator for sequential leaf scanning.

### 6.1 Iterator Overview

#### 6.1.1 Purpose

The index iterator provides a way to traverse all key-value pairs in the B+ Tree in sorted order, supporting range queries and full table scans.

**Use Cases:**
- Range queries: `SELECT * FROM table WHERE key >= 100 AND key < 200`
- Full table scans: `SELECT * FROM table`
- Iterator-based algorithms: `std::for_each`, range-based for loops

#### 6.1.2 Design Principles

**Sequential Access:**
- Iterator traverses leaf pages left-to-right
- Uses next_page_id_ links between leaves
- No tree traversal needed after initial positioning

**Read-Only:**
- Iterator uses ReadPageGuard (not WritePageGuard)
- Multiple iterators can coexist
- Iterator does not modify tree structure

**NOT Thread-Safe:**
- Requirements explicitly state iterator doesn't need thread safety
- Concurrent modifications during iteration cause undefined behavior
- Proper implementation would throw exception if sibling latch unavailable

### 6.2 Data Members

**IndexIterator Class:**
```cpp
class IndexIterator {
 private:
  BufferPoolManager *bpm_;    // Buffer pool reference
  ReadPageGuard guard_;       // Current leaf page guard
  int index_;                 // Current position in leaf (0 to size-1)
  bool is_end_;               // True for end iterator
};
```

**Member Explanations:**

**bpm_**
- Pointer to buffer pool manager
- Used to fetch next leaf page during iteration
- Must not be null (except for end iterator)

**guard_**
- RAII guard holding current leaf page
- Automatically releases latch and unpins page
- Invalid for end iterator

**index_**
- Current position within leaf page
- Range: 0 to leaf->GetSize() - 1
- Set to 0 for end iterator (convention)

**is_end_**
- Flag marking end iterator
- true: Iterator is at end (past last element)
- false: Iterator points to valid element

### 6.3 Constructors

#### 6.3.1 Default Constructor (End Iterator)

**Algorithm:**
```
Purpose: Create end iterator

Steps:
  1. Set bpm_ to nullptr
  2. Leave guard_ invalid (default-constructed)
  3. Set index_ to 0
  4. Set is_end_ to true

Pseudocode:
  IndexIterator()
    : bpm_(nullptr), guard_(), index_(0), is_end_(true) {}
```

**Usage:**
```cpp
IndexIterator end_it;  // End iterator
```

#### 6.3.2 Position-Specific Constructor

**Algorithm:**
```
Purpose: Create iterator at specific position

Parameters:
  - bpm: Buffer pool manager pointer
  - guard: ReadPageGuard for current leaf
  - index: Position within leaf
  - is_end: Whether this is end iterator

Pseudocode:
  IndexIterator(BufferPoolManager *bpm,
                ReadPageGuard &&guard,
                int index,
                bool is_end)
    : bpm_(bpm),
      guard_(std::move(guard)),
      index_(index),
      is_end_(is_end) {}
```

**Important:** Use std::move() for guard parameter to transfer ownership

### 6.4 Iterator Interface

#### 6.4.1 IsEnd()

Check if iterator is at end.

**Algorithm:**
```
Purpose: Check if iterator has reached end

Returns: true if at end, false otherwise

Pseudocode:
  bool IsEnd() const {
    return is_end_;
  }
```

#### 6.4.2 operator*() - Dereference

Access current key-value pair.

**Algorithm:**
```
Purpose: Get key-value pair at current position

Returns: std::pair<const KeyType&, const ValueType&>

Precondition: Iterator must not be at end

Pseudocode:
  auto operator*() const -> const MappingType& {
    assert(!is_end_)  // Must not be at end

    leaf = guard_.As<LeafPage>()
    assert(index_ < leaf->GetSize())

    key_ref = leaf->KeyAt(index_)
    value_ref = leaf->ValueAt(index_)

    return std::pair<const KeyType&, const ValueType&>(key_ref, value_ref)
  }
```

**Note:** Return type might be `const std::pair<KeyType, ValueType>&` or `std::pair<const KeyType&, const ValueType&>` depending on your MappingType definition.

**Usage:**
```cpp
auto [key, value] = *it;  // C++17 structured binding
```

#### 6.4.3 operator++() - Increment

Advance iterator to next element.

**Algorithm:**
```
Purpose: Move to next key-value pair

Returns: Reference to self (for chaining)

Steps:
  1. Check if at end -> do nothing if true
  2. Increment index
  3. If index reaches end of current leaf:
     a. Move to next leaf page
     b. Reset index to 0
  4. If no next leaf -> set is_end_ = true

Pseudocode:
  auto operator++() -> IndexIterator& {
    if is_end_:
      return *this  // Already at end

    leaf = guard_.As<LeafPage>()

    // Move to next position
    index_++

    // Check if reached end of current page
    if index_ >= leaf->GetSize():
      next_page_id = leaf->GetNextPageId()

      if next_page_id == INVALID_PAGE_ID:
        // No more pages, reached end
        is_end_ = true
        guard_ = ReadPageGuard{}  // Release current page
        return *this

      // Move to next leaf
      guard_ = bpm_->ReadPage(next_page_id)
      index_ = 0

    return *this
  }
```

**Key Points:**
- Post-increment moves within current page first
- Only fetches next page when current exhausted
- Automatically releases old page (RAII)
- Sets is_end_ when no more pages

**Usage:**
```cpp
++it;  // Pre-increment (return reference)
```

#### 6.4.4 operator==() and operator!=()

Compare two iterators.

**Algorithm:**
```
Purpose: Check if two iterators point to same position

Returns: true if equal, false otherwise

Comparison Logic:
  - Both at end -> equal
  - One at end, one not -> not equal
  - Same page and same index -> equal
  - Otherwise -> not equal

Pseudocode:
  auto operator==(const IndexIterator &other) const -> bool {
    // Both at end
    if is_end_ AND other.is_end_:
      return true

    // One at end
    if is_end_ OR other.is_end_:
      return false

    // Compare page and index
    return guard_.GetPageId() == other.guard_.GetPageId()
           AND index_ == other.index_
  }

  auto operator!=(const IndexIterator &other) const -> bool {
    return !(*this == other)
  }
```

**Important:** Two end iterators are always equal, even if created differently.

### 6.5 B+ Tree Integration

#### 6.5.1 Begin() - First Element

Return iterator to first element in tree.

**Algorithm:**
```
Purpose: Create iterator at first key-value pair

Returns: IndexIterator at beginning of tree

Steps:
  1. Check if tree is empty -> return End()
  2. Navigate to leftmost leaf
  3. Create iterator at position 0

Pseudocode (in BPlusTree class):
  auto Begin() -> IndexIterator {
    // Check empty
    header_guard = bpm_->ReadPage(header_page_id_)
    header = header_guard.As<BPlusTreeHeaderPage>()
    root_page_id = header->root_page_id_

    if root_page_id == INVALID_PAGE_ID:
      return End()

    // Navigate to leftmost leaf
    current_page_id = root_page_id
    current_guard = bpm_->ReadPage(current_page_id)

    while true:
      page = current_guard.As<BPlusTreePage>()

      if page->IsLeafPage():
        break

      // Internal page - go to leftmost child
      internal = reinterpret_cast<const InternalPage*>(page)
      leftmost_child = internal->ValueAt(0)

      current_guard = bpm_->ReadPage(leftmost_child)

    // Create iterator at start of leftmost leaf
    return IndexIterator(bpm_, std::move(current_guard), 0, false)
  }
```

**Leftmost Leaf:**
- Always follow first pointer (ValueAt(0)) in internal nodes
- First pointer leads to subtree with smallest keys

#### 6.5.2 End() - Past-The-End Iterator

Return end iterator.

**Algorithm:**
```
Purpose: Create iterator representing end

Returns: Default-constructed end iterator

Pseudocode:
  auto End() -> IndexIterator {
    return IndexIterator()  // Default constructor creates end iterator
  }
```

**C++ Convention:**
- End iterator points "past the end"
- Dereferencing end iterator is undefined behavior
- Used as sentinel in range-based loops

#### 6.5.3 Begin(key) - Position At Key

Return iterator starting from given key.

**Algorithm:**
```
Purpose: Create iterator at first key >= input key

Returns: IndexIterator positioned at key or next greater key

Steps:
  1. Check if tree is empty -> return End()
  2. Navigate to leaf containing key
  3. Use LowerBound to find position
  4. If position is past end of leaf, advance to next leaf
  5. Create iterator at found position

Pseudocode:
  auto Begin(const KeyType &key) -> IndexIterator {
    // Check empty
    header_guard = bpm_->ReadPage(header_page_id_)
    header = header_guard.As<BPlusTreeHeaderPage>()
    root_page_id = header->root_page_id_

    if root_page_id == INVALID_PAGE_ID:
      return End()

    // Navigate to leaf
    current_page_id = root_page_id
    current_guard = bpm_->ReadPage(current_page_id)

    while true:
      page = current_guard.As<BPlusTreePage>()

      if page->IsLeafPage():
        break

      internal = reinterpret_cast<const InternalPage*>(page)
      child_page_id = internal->Lookup(key, comparator_)
      current_guard = bpm_->ReadPage(child_page_id)

    // Find position in leaf
    leaf = current_guard.As<LeafPage>()
    index = leaf->LowerBound(key, comparator_)

    // Check if position is valid
    if index >= leaf->GetSize():
      // Key would be after this leaf, check next leaf
      next_page_id = leaf->GetNextPageId()

      if next_page_id == INVALID_PAGE_ID:
        return End()  // No next leaf, reached end

      // Move to next leaf
      current_guard = bpm_->ReadPage(next_page_id)
      index = 0

    return IndexIterator(bpm_, std::move(current_guard), index, false)
  }
```

**Edge Case:** Key is greater than all keys in leaf
- Must check next_page_id_
- If no next leaf, return End()
- Otherwise, move to next leaf and start at index 0

### 6.6 Usage Examples

#### 6.6.1 Range-Based For Loop

**C++17 Range-Based For:**
```cpp
// Iterate over all entries
for (const auto &[key, value] : tree) {
  std::cout << "Key: " << key << ", Value: " << value << std::endl;
}
```

**How It Works:**
- Calls `tree.Begin()` to get start iterator
- Calls `tree.End()` to get end sentinel
- Increments iterator until it equals end
- Dereferences iterator to get key-value pairs

#### 6.6.2 Manual Iteration

**Explicit Iterator Loop:**
```cpp
for (auto it = tree.Begin(); it != tree.End(); ++it) {
  auto [key, value] = *it;
  // Process key-value pair
}
```

#### 6.6.3 Range Query

**Query Specific Range:**
```cpp
// Find all keys in range [100, 200)
auto start = tree.Begin(KeyType(100));
auto end = tree.Begin(KeyType(200));

for (auto it = start; it != end; ++it) {
  auto [key, value] = *it;
  // Process entries with key in [100, 200)
}
```

**Note:** This requires implementing comparison between iterator and key, or manually checking key in loop.

#### 6.6.4 STL Algorithm Compatibility

**Count Elements:**
```cpp
size_t count = std::distance(tree.Begin(), tree.End());
```

**Find Specific Key:**
```cpp
auto it = std::find_if(tree.Begin(), tree.End(),
                      [&](const auto &pair) {
                        return pair.first == target_key;
                      });
```

### 6.7 Common Implementation Issues

#### 6.7.1 Guard Ownership

**Problem:** Iterator holds guard, must manage lifetime correctly

**Solution:**
- Use std::move() when constructing iterator
- Guard automatically releases when iterator destroyed
- Don't access guard after moving from it

#### 6.7.2 End Iterator Dereferencing

**Problem:** Attempting to dereference end iterator

**Solution:**
- Always check `IsEnd()` before dereferencing
- Add assertions in operator*() to catch bugs
- Document that dereferencing end is undefined behavior

#### 6.7.3 Concurrent Modification

**Problem:** Tree modified while iterating

**Solution:**
- Document that iterator is not thread-safe
- For proper implementation, could acquire read latch on header
- Or throw exception if can't acquire next leaf latch

#### 6.7.4 Empty Tree

**Problem:** Creating iterator on empty tree

**Solution:**
- Begin() returns End() iterator
- All iteration loops immediately terminate
- No special case needed in iterator logic

#### 6.7.5 Single Leaf Tree

**Problem:** Tree has only one leaf (root is leaf)

**Solution:**
- Iterator works normally
- When index reaches leaf size, checks next_page_id
- Finds INVALID_PAGE_ID, sets is_end_ = true
- No special case needed

### 6.8 Advanced: Skip Tombstones (Optional)

If your leaf pages support tombstone-based deletion, iterator should skip tombstoned entries.

**Modified operator++():**
```
auto operator++() -> IndexIterator& {
  if is_end_:
    return *this

  leaf = guard_.As<LeafPage>()

  // Move to next position
  index_++

  // Skip tombstones
  SkipTombstones()

  return *this
}

Helper Method:
void SkipTombstones() {
  while true:
    if is_end_:
      return

    leaf = guard_.As<LeafPage>()

    // Skip tombstoned entries in current page
    while index_ < leaf->GetSize() AND leaf->IsTombstone(index_):
      index_++

    // If found live entry, done
    if index_ < leaf->GetSize():
      return

    // Reached end of page, move to next
    next_page_id = leaf->GetNextPageId()

    if next_page_id == INVALID_PAGE_ID:
      is_end_ = true
      guard_ = ReadPageGuard{}
      return

    guard_ = bpm_->ReadPage(next_page_id)
    index_ = 0
}
```

**Note:** Standard version without tombstones doesn't need this logic.

### 6.9 Testing Iterator

#### 6.9.1 Basic Tests

**Empty Tree:**
```cpp
auto tree = CreateEmptyTree();
assert(tree.Begin() == tree.End());
```

**Single Entry:**
```cpp
tree.Insert(10, value1);
auto it = tree.Begin();
assert(!it.IsEnd());
auto [key, value] = *it;
assert(key == 10);
++it;
assert(it == tree.End());
```

**Multiple Entries:**
```cpp
tree.Insert(10, v1);
tree.Insert(20, v2);
tree.Insert(30, v3);

std::vector<int> keys;
for (auto [key, value] : tree) {
  keys.push_back(key);
}
assert(keys == std::vector<int>{10, 20, 30});
```

#### 6.9.2 Range Query Tests

**Begin(key) Positioning:**
```cpp
tree.Insert(10, v1);
tree.Insert(20, v2);
tree.Insert(30, v3);

// Start from 20
auto it = tree.Begin(KeyType(20));
auto [key, value] = *it;
assert(key == 20);

// Start from 15 (not present)
it = tree.Begin(KeyType(15));
[key, value] = *it;
assert(key == 20);  // Should position at next key

// Start from 40 (past end)
it = tree.Begin(KeyType(40));
assert(it == tree.End());
```

#### 6.9.3 Multi-Page Tests

**Iterate Across Pages:**
```cpp
// Insert enough keys to create multiple leaf pages
for (int i = 0; i < 1000; i++) {
  tree.Insert(i, RID(i, 0));
}

// Verify all keys present in order
int expected = 0;
for (auto [key, value] : tree) {
  assert(key == expected);
  expected++;
}
assert(expected == 1000);
```

#### 6.9.4 Edge Cases

**Iterator After Deletion:**
```cpp
tree.Insert(10, v1);
tree.Insert(20, v2);

auto it = tree.Begin();
tree.Remove(10);  // Remove first key

// Iterator may be invalidated (undefined behavior)
// Document this behavior
```

**Multiple Iterators:**
```cpp
auto it1 = tree.Begin();
auto it2 = tree.Begin();

assert(it1 == it2);  // Should be equal

++it1;
assert(it1 != it2);  // Now different
```

### 6.10 Performance Considerations

**Sequential Scan Complexity:**
- Time: O(N) where N is number of entries
- I/O: O(P) where P is number of leaf pages
- Each leaf page fetched exactly once
- Very efficient for range queries

**Random Access:**
- Not supported by iterator
- Must create new iterator with Begin(key) for each access
- Less efficient than direct GetValue()

**Memory Usage:**
- Iterator holds one ReadPageGuard (one page pinned)
- Lightweight, many iterators can coexist
- Guards automatically released when iterator destroyed

---

## 7. Task 4: Concurrency Control

### 7.1 Latch Coupling Overview

**Latch coupling** (also called **crabbing**) is a technique to allow concurrent access to the B+ Tree while maintaining correctness.

**Goal:** Maximize concurrency while preventing race conditions

**Key Principle:** Hold parent latch until child is safely latched

### 7.2 Basic Protocol

**Traversal Pattern:**
```
1. Latch parent node
2. Latch child node
3. Check if child is "safe"
4. If safe: Release parent latch
5. If unsafe: Keep parent latch (may need to modify parent)
6. Continue to next level
```

**Safe Node Definition:**
- **Insert**: Node won't split after insertion (size < max_size)
- **Delete**: Node won't merge after deletion (size > min_size)
- **Root**: Always considered safe

### 7.3 Optimistic Latch Coupling

**Algorithm for Insert:**
```
FindLeaf(key, INSERT, context):
  // 1. Latch header (protects root_page_id)
  header_guard = bpm->WritePage(header_page_id_)
  context->header_page_ = std::move(header_guard)

  // 2. Latch root
  root_guard = bpm->WritePage(root_page_id)

  // 3. Check if root is safe
  if IsSafeNode(root, INSERT):
    // Root won't split, can release header
    context->header_page_ = std::nullopt

  context->write_set_.push_back(std::move(root_guard))

  // 4. Descend tree
  while not at leaf:
    current = context->write_set_.back()
    child_page_id = current->Lookup(key, comparator_)

    // Latch child BEFORE releasing parent
    child_guard = bpm->WritePage(child_page_id)

    // Check if child is safe
    if IsSafeNode(child, INSERT):
      // Can release all ancestors
      while context->write_set_.size() > 0:
        context->write_set_.pop_front()

    context->write_set_.push_back(std::move(child_guard))
```

**Key Points:**
- Acquire child latch BEFORE releasing parent
- Safe node allows releasing all ancestors
- Unsafe node keeps entire path latched
- Header protects root_page_id changes

### 7.4 Read Operations

**GetValue uses read latches:**
```
GetValue(key, result):
  // Use ReadPageGuard (shared latches)
  current_guard = bpm->ReadPage(root_page_id)

  while not at leaf:
    internal = current_guard.As<InternalPage>()
    child_id = internal->Lookup(key, comparator_)

    // Can release parent immediately (read-only)
    current_guard = bpm->ReadPage(child_id)

  leaf = current_guard.As<LeafPage>()
  return leaf->Lookup(key, result, comparator_)
```

**Optimization:** No need to hold path for reads

### 7.5 Latch Order Rules

**CRITICAL:** Always acquire latches in the same order to prevent deadlock

**Order:** Header → Root → Level 1 → ... → Leaf

**Never:**
- Acquire parent after child
- Acquire same latch twice in one thread
- Hold latches while waiting for I/O

### 7.6 Contention Requirements

Tests measure **contention ratio** = (total latch wait time) / (total operation time)

**Required Range:** [2.5, 3.5]
- < 2.5: Too coarse locking (global locks)
- > 3.5: Too much contention (holding latches too long)

**Tips to achieve good contention:**
- Release ancestor latches early (safe node optimization)
- Use read latches for GetValue
- Don't hold latches during page copies

---

## 8. Concurrency Deep Dive

### 8.1 Deadlock Scenarios

**Scenario 1: Cycle in Latch Order**
```
Thread 1: Holds Page A, wants Page B
Thread 2: Holds Page B, wants Page A
→ DEADLOCK
```

**Prevention:** Always acquire latches top-down (header → root → leaf)

**Scenario 2: Acquiring Same Latch Twice**
```
Thread 1: Holds read latch on Page A
Thread 1: Tries to acquire write latch on Page A
→ DEADLOCK (read latch blocks write)
```

**Prevention:** Never call GetValue while holding latches on pages

### 8.2 Race Conditions

**Race 1: Root Change**
```
Thread 1: Reads root_page_id = 10
Thread 2: Splits root, updates root_page_id = 20
Thread 1: Latches page 10 (now stale)
```

**Solution:** Latch header page to protect root_page_id reads/writes

**Race 2: Concurrent Split**
```
Thread 1: Splits leaf, updating parent
Thread 2: Splits leaf, updating same parent
→ Concurrent modifications to parent
```

**Solution:** Hold parent latch until split completes

### 8.3 Complete Insert Algorithm with Latch Coupling

```
Insert(key, value):
  context = new Context()

  // 1. Acquire header latch
  context->header_page_ = bpm->WritePage(header_page_id_)
  context->root_page_id_ = header->root_page_id_

  // 2. Check empty tree
  if root_page_id == INVALID_PAGE_ID:
    StartNewTree(key, value, context)
    return true

  // 3. Latch root
  root_guard = bpm->WritePage(root_page_id)
  if IsSafeNode(root, INSERT):
    context->header_page_ = std::nullopt  // Release header
  context->write_set_.push_back(std::move(root_guard))

  // 4. Navigate to leaf with latch coupling
  while true:
    current_guard = context->write_set_.back()
    current = current_guard.As<BPlusTreePage>()

    if current->IsLeafPage():
      break

    // Find child
    internal = reinterpret_cast<InternalPage*>(current)
    child_id = internal->Lookup(key, comparator_)

    // Latch child
    child_guard = bpm->WritePage(child_id)

    // Check safety
    if IsSafeNode(child, INSERT):
      // Release all ancestors
      context->header_page_ = std::nullopt
      while context->write_set_.size() > 1:
        context->write_set_.pop_front()

    context->write_set_.push_back(std::move(child_guard))

  // 5. Insert into leaf
  leaf_guard = context->write_set_.back()
  leaf = leaf_guard.AsMut<LeafPage>()

  if leaf->Lookup(key, &existing, comparator_):
    ReleaseContext(context)
    return false

  leaf->Insert(key, value, comparator_)

  // 6. Handle overflow
  if leaf->GetSize() > leaf->GetMaxSize():
    SplitLeaf(leaf, &leaf_guard, context)

  // 7. Release all latches
  ReleaseContext(context)
  return true
```

### 8.4 Latch Coupling Visualization

```
Example: Insert key 25 into tree with max_size = 4

Initial state:
         [20]           (Root, size=1)
        /    \
    [10,15] [20,30]     (Leaves)

Thread inserts 25:

Step 1: Latch header
  LATCHED: [Header]

Step 2: Latch root [20]
  LATCHED: [Header], [20]
  Check: Root safe? size(1) < max(4) → YES
  Release: [Header]
  LATCHED: [20]

Step 3: Latch child [20,30]
  Find child for key 25: [20,30]
  LATCHED: [20], [20,30]
  Check: Leaf safe? size(2) < max(4) → YES
  Release: [20]
  LATCHED: [20,30]

Step 4: Insert 25
  [20,30] becomes [20,25,30] (size=3)
  No split needed
  Release: [20,30]
  LATCHED: (none)
```

### 8.5 Pessimistic Scenario

```
Insert key 25 when leaf is full:

Initial:
         [20]
        /    \
   [10,15] [20,30,35,40]  (size=4, max=4)

Step 1-2: Latch header, root
  LATCHED: [Header], [20]
  Check: Root safe? YES
  Release: [Header]

Step 3: Latch leaf [20,30,35,40]
  LATCHED: [20], [20,30,35,40]
  Check: Leaf safe? size(4) >= max(4) → NO
  Keep: [20] (will need to update parent)
  LATCHED: [20], [20,30,35,40]

Step 4: Insert 25
  [20,30,35,40] becomes [20,25,30,35,40] (size=5)

Step 5: Split leaf
  Left: [20,25,30]
  Right: [35,40]
  Middle key: 35

  Insert 35 into parent [20]:
  LATCHED: [20], [20,25,30], [35,40]
  Parent [20] becomes [20,35]

  Release all
```

---

## 9. Critical Implementation Considerations

### 9.1 Deadlock Prevention Checklist

- [ ] Always acquire latches top-down (header → root → leaf)
- [ ] Never acquire same latch twice in one thread
- [ ] Release latches in same order as acquisition
- [ ] Don't call recursive operations while holding latches
- [ ] Use timeout/try_lock if implementing optional features

### 9.2 Race Condition Checklist

- [ ] Latch header page when reading/writing root_page_id
- [ ] Hold parent latch during split until parent updated
- [ ] Atomic updates to page metadata (size, next_page_id)
- [ ] Proper ordering of guard acquisition (child after parent)

### 9.3 Memory Management Pitfalls

**❌ Wrong:**
```cpp
auto page = new BPlusTreeLeafPage();  // Direct allocation
```

**✅ Correct:**
```cpp
auto guard = bpm_->WritePage(page_id);
auto page = guard.AsMut<LeafPage>();
```

**❌ Wrong:**
```cpp
guard.Drop();
auto page = guard.AsMut<LeafPage>();  // Use after Drop
```

**✅ Correct:**
```cpp
auto page = guard.AsMut<LeafPage>();
// Use page...
guard.Drop();  // Drop after done
```

### 9.4 Edge Cases

**Empty Tree:**
- Insert: Create first leaf as root
- Delete: No-op
- Search: Return false

**Single Key Tree:**
- Root is leaf with one entry
- Delete makes tree empty
- Min size doesn't apply to root

**Root Split:**
- Create new internal root
- Old root becomes child
- Tree height increases
- Update header_page_id

**Root Merge:**
- Root has single child
- Child becomes new root
- Tree height decreases
- Update header_page_id

**First Key in Internal:**
- Always INVALID, never used
- Lookup starts from index 1
- Binary search handles this

**Leaf Chain:**
- Must update next_page_id during split
- Must update sibling's next during merge
- Iterator depends on correct chain

### 9.5 Common Bugs

**Bug 1: Off-by-One in Split Timing**
- Leaf: Split AFTER insert (size = max+1)
- Internal: Split BEFORE insert (size = max)
- Mixing these causes assertion failures

**Bug 2: Forgetting to Update Header**
- Must update when root splits or merges
- Results in tree becoming unreachable

**Bug 3: Parent Index Calculation**
- Parent is at `write_set_[current_index - 1]`
- Don't use hardcoded indices

**Bug 4: Not Using Binary Search**
- Linear search times out on large tests
- Always use std::lower_bound or binary search

**Bug 5: Incorrect Min Size Formula**
- Should be `(max_size + 1) / 2` (ceiling)
- Not `max_size / 2` (floor)

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Day 1-2: Page Classes**
- Implement BPlusTreePage base class
- Implement basic accessors (GetSize, SetSize, etc.)
- Test: Create pages, verify initialization

**Day 3-4: Internal Page**
- Implement Init, KeyAt, ValueAt, SetKeyAt
- Implement Lookup with binary search
- Implement InsertAt, Remove
- Test: Insert/remove entries, test Lookup

**Day 5-6: Leaf Page**
- Implement Init, KeyAt, ValueAt
- Implement LowerBound with binary search
- Implement Insert, RemoveAt
- Test: Insert/remove entries, verify sorted order

**Milestone 1:** All page classes pass unit tests

### Phase 2: Simple Operations (Week 2)

**Day 1-2: Simple Insert**
- Implement Insert without splits
- Implement StartNewTree
- Implement FindLeaf (without latch coupling)
- Test: Insert into empty tree, insert multiple keys

**Day 3-4: Search**
- Implement GetValue
- Test: Search for existing/non-existing keys

**Day 5-6: Simple Delete**
- Implement Remove without merges
- Test: Delete from non-underflowing leaf

**Milestone 2:** Insert/search/delete work on small trees

### Phase 3: Splits (Week 3)

**Day 1-2: Leaf Split**
- Implement SplitLeaf
- Implement MoveHalfTo in leaf page
- Implement InsertIntoParent
- Test: Insert causing single leaf split

**Day 3-4: Internal Split**
- Implement SplitInternal
- Implement MoveHalfTo in internal page
- Test: Insert causing multiple splits

**Day 5-6: Root Split**
- Implement CreateNewRoot
- Update header page
- Test: Insert causing root split

**Milestone 3:** Insert with splits passes all tests

### Phase 4: Merges (Week 4)

**Day 1-2: Redistribute**
- Implement CoalesceOrRedistribute
- Implement Redistribute for leaf and internal
- Test: Delete causing redistribution

**Day 3-4: Coalesce**
- Implement Coalesce for leaf and internal
- Update parent after merge
- Test: Delete causing merge

**Day 5-6: Root Adjust**
- Implement AdjustRoot
- Handle empty tree
- Test: Delete causing root merge

**Milestone 4:** Delete with merges passes all tests

### Phase 5: Iterator (Week 5)

**Day 1-2: Basic Iterator**
- Implement constructors
- Implement operator*, operator++
- Implement operator==, operator!=
- Test: Iterate single page

**Day 3-4: Multi-Page Iterator**
- Implement next page navigation
- Test: Iterate across multiple pages

**Day 5: Begin/End**
- Implement Begin(), End(), Begin(key)
- Test: Range-based for loops

**Milestone 5:** Iterator tests pass

### Phase 6: Concurrency (Week 6)

**Day 1-2: Latch Coupling**
- Implement IsSafeNode
- Modify FindLeaf for latch coupling
- Test: Sequential operations still work

**Day 3-4: Read Latches**
- Use ReadPageGuard in GetValue
- Test: Concurrent reads

**Day 5-6: Concurrent Tests**
- Run concurrent insert/delete tests
- Tune contention ratio
- Debug deadlocks

**Milestone 6:** All tests pass, contention ratio in [2.5, 3.5]

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Page Classes:**
```bash
make b_plus_tree_page_test
./test/b_plus_tree_page_test
```

### 11.2 Functional Tests

**Insert Test:**
```bash
make b_plus_tree_insert_test -j$(nproc)
./test/b_plus_tree_insert_test
```

Tests:
- Insert into empty tree
- Insert duplicate (should fail)
- Sequential insert
- Random insert
- Insert causing splits

**Delete Test:**
```bash
make b_plus_tree_delete_test -j$(nproc)
./test/b_plus_tree_delete_test
```

Tests:
- Delete from leaf
- Delete non-existent key
- Delete causing redistribution
- Delete causing coalesce
- Delete all keys

**Scale Test:**
```bash
make b_plus_tree_sequential_scale_test -j$(nproc)
./test/b_plus_tree_sequential_scale_test
```

Tests:
- Large-scale sequential operations
- Performance benchmarks

### 11.3 Concurrent Tests

**Concurrent Test:**
```bash
make b_plus_tree_concurrent_test -j$(nproc)
./test/b_plus_tree_concurrent_test
```

Tests:
- Concurrent inserts
- Concurrent deletes
- Mixed operations
- Thread safety

**Contention Test:**
```bash
make b_plus_tree_contention_test -j$(nproc)
./test/b_plus_tree_contention_test
```

Measures contention ratio (must be in [2.5, 3.5])

### 11.4 Debugging Tools

**Tree Printer:**
```bash
make b_plus_tree_printer -j
./bin/b_plus_tree_printer

# Commands:
>> 5 5              # Set max sizes
>> i 10 100         # Insert key 10, value 100
>> d 10             # Delete key 10
>> s 10             # Search key 10
>> g tree.dot       # Generate dot file
>> q                # Quit

# Visualize:
dot -Tpng tree.dot -o tree.png
```

**Memory Checks:**
```bash
# AddressSanitizer (enabled by default in debug)
./test/b_plus_tree_insert_test

# Valgrind (Linux)
valgrind --leak-check=full ./test/b_plus_tree_insert_test
```

---

## 12. Algorithms in Pseudocode

### 12.1 Complete Insert Algorithm

```
Insert(key, value):
  // Setup
  context = new Context()
  header_guard = bpm->WritePage(header_page_id_)
  context->header_page_ = std::move(header_guard)
  root_page_id = header->root_page_id_

  // Empty tree
  if root_page_id == INVALID_PAGE_ID:
    root_id = bpm->NewPage()
    root_guard = bpm->WritePage(root_id)
    root_leaf = root_guard.AsMut<LeafPage>()
    root_leaf->Init(leaf_max_size_ + 1)
    root_leaf->Insert(key, value, comparator_)
    header->root_page_id_ = root_id
    context->header_page_ = std::nullopt
    return true

  // Navigate with latch coupling
  context->root_page_id_ = root_page_id
  current_guard = bpm->WritePage(root_page_id)

  if IsSafeNode(current, INSERT):
    context->header_page_ = std::nullopt

  context->write_set_.push_back(std::move(current_guard))

  while true:
    current = context->write_set_.back().AsMut<BPlusTreePage>()

    if current->IsLeafPage():
      break

    internal = reinterpret_cast<InternalPage*>(current)
    child_id = internal->Lookup(key, comparator_)
    child_guard = bpm->WritePage(child_id)

    if IsSafeNode(child, INSERT):
      context->header_page_ = std::nullopt
      while context->write_set_.size() > 1:
        context->write_set_.pop_front()

    context->write_set_.push_back(std::move(child_guard))

  // Insert
  leaf = context->write_set_.back().AsMut<LeafPage>()

  if leaf->Lookup(key, &existing, comparator_):
    ReleaseContext(context)
    return false

  leaf->Insert(key, value, comparator_)

  // Split if needed
  if leaf->GetSize() > leaf->GetMaxSize():
    new_page_id = bpm->NewPage()
    new_guard = bpm->WritePage(new_page_id)
    new_leaf = new_guard.AsMut<LeafPage>()
    new_leaf->Init(leaf_max_size_ + 1)
    new_leaf->SetNextPageId(leaf->GetNextPageId())
    leaf->SetNextPageId(new_page_id)
    leaf->MoveHalfTo(new_leaf)
    separator = new_leaf->KeyAt(0)

    if context->IsRootPage(leaf_page_id):
      // Root split
      new_root_id = bpm->NewPage()
      new_root_guard = bpm->WritePage(new_root_id)
      root = new_root_guard.AsMut<InternalPage>()
      root->Init(internal_max_size_ + 1)
      root->SetKeyAt(0, KeyType{})
      root->SetValueAt(0, leaf_page_id)
      root->SetKeyAt(1, separator)
      root->SetValueAt(1, new_page_id)
      root->SetSize(2)
      header->root_page_id_ = new_root_id
    else:
      // Insert into parent
      parent = context->write_set_[write_set_.size()-2].AsMut<InternalPage>()
      parent->InsertNodeAfter(leaf_page_id, separator, new_page_id)

  ReleaseContext(context)
  return true
```

### 12.2 Complete Delete Algorithm

```
Remove(key):
  // Setup
  context = new Context()
  header_guard = bpm->WritePage(header_page_id_)
  context->header_page_ = std::move(header_guard)
  root_page_id = header->root_page_id_

  if root_page_id == INVALID_PAGE_ID:
    return

  // Navigate (similar to insert)
  context->root_page_id_ = root_page_id
  FindLeaf(key, DELETE, context)

  // Remove
  leaf = context->write_set_.back().AsMut<LeafPage>()
  index = leaf->LowerBound(key, comparator_)

  if index >= leaf->GetSize() OR key != leaf->KeyAt(index):
    ReleaseContext(context)
    return

  leaf->RemoveAt(index)

  // Handle underflow
  if leaf->GetSize() < leaf->GetMinSize():
    if context->IsRootPage(leaf_page_id):
      if leaf->GetSize() == 0:
        header->root_page_id_ = INVALID_PAGE_ID
        bpm->DeletePage(leaf_page_id)
    else:
      parent = context->write_set_[write_set_.size()-2].AsMut<InternalPage>()
      node_pos = parent->ValueIndex(leaf_page_id)

      // Try left sibling
      if node_pos > 0:
        sibling_id = parent->ValueAt(node_pos - 1)
        sibling_guard = bpm->WritePage(sibling_id)
        sibling = sibling_guard.AsMut<LeafPage>()

        if sibling->GetSize() > sibling->GetMinSize():
          // Redistribute
          sibling->MoveLastToFrontOf(leaf)
          parent->SetKeyAt(node_pos, leaf->KeyAt(0))
        else:
          // Merge
          leaf->MoveAllTo(sibling)
          parent->Remove(node_pos)
          bpm->DeletePage(leaf_page_id)

          // Check parent underflow
          if parent->GetSize() < parent->GetMinSize():
            // Recursively fix parent...

  ReleaseContext(context)
```

### 12.3 IsSafeNode

```
IsSafeNode(page, operation):
  if operation == INSERT:
    return page->GetSize() < page->GetMaxSize()

  if operation == DELETE:
    return page->GetSize() > page->GetMinSize()

  return false
```

---

## 13. Key Constraints & Rules Summary

### 13.1 Structural Constraints

| Rule | Value |
|------|-------|
| Min size (non-root) | ⌈max_size / 2⌉ |
| Max size | Configured (leaf_max_size, internal_max_size) |
| Root min size | 1 (no minimum) |
| Keys per node | Equal to values (not keys+1) |
| First key in internal | INVALID (unused) |
| Leaf sibling links | next_page_id_ (rightmost = INVALID) |

### 13.2 Operation Rules

**Insert:**
- Return false if key exists
- Leaf splits when size > max_size AFTER insert
- Internal splits when size == max_size BEFORE insert
- Update header when root changes
- Must use binary search

**Delete:**
- No-op if key doesn't exist
- Redistribute if sibling has extra entries
- Merge if sibling at minimum
- Update header when root changes
- Root can become empty (tree becomes empty)

**Search:**
- Use ReadPageGuard (shared latches)
- Binary search in pages
- Return false if key not found

### 13.3 Concurrency Rules

**Latch Order:**
- Always: Header → Root → Internal → Leaf
- Never reverse order
- Never acquire same latch twice

**Latch Coupling:**
- Acquire child before releasing parent
- Release ancestors when safe node found
- Hold entire path for unsafe nodes

**Safe Node:**
- Insert: size < max_size (won't split)
- Delete: size > min_size (won't merge)

**Contention Ratio:**
- Must be in range [2.5, 3.5]
- < 2.5: Too coarse (global locks)
- > 3.5: Too much contention

### 13.4 Implementation Rules

**Memory:**
- Never use new/delete for pages
- Always use BufferPoolManager
- Only add trivially-constructed types to pages
- No std::vector in page classes

**Guard Usage:**
- Use ReadPageGuard for reads
- Use WritePageGuard for writes
- Guards auto-release on destruction
- Drop() before DeletePage()

**Binary Search:**
- Required for Lookup and LowerBound
- Linear search causes timeout
- Use std::lower_bound or manual implementation

---

## 14. Conclusion

This guide has covered the complete implementation of a thread-safe B+ Tree index, including:

1. **Page Classes** - Foundation data structures for internal and leaf nodes
2. **Core Operations** - Insert, delete, and search with proper split/merge handling
3. **Iterator** - Sequential leaf scanning for range queries
4. **Concurrency** - Latch coupling protocol for thread-safe operations

**Key Takeaways:**

- **Buffer Pool Integration**: All page access through guards (RAII)
- **Latch Coupling**: Acquire child before releasing parent, release ancestors early
- **Safe Nodes**: Key optimization for reducing contention
- **Binary Search**: Required for performance (O(log n) vs O(n))
- **Edge Cases**: Empty tree, root split/merge, first invalid key in internal

**Success Criteria:**

✅ All tests pass (insert, delete, concurrent)
✅ Contention ratio in [2.5, 3.5]
✅ No memory leaks (ASAN clean)
✅ Code formatted (make format)
✅ Linting passes (make check-lint)

**Next Steps:**

1. Implement page classes (Task 1)
2. Implement core operations (Task 2)
3. Implement iterator (Task 3)
4. Add latch coupling (Task 4)
5. Test thoroughly
6. Optimize for leaderboard (optional: tombstones, read latches)

Good luck with your implementation!

---

**Document Version:** 1.0
**Total Length:** ~16,000 words
**Sections:** 14
**Target Audience:** Database system students implementing CMU 15-445 Project 2

