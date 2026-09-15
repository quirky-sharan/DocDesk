# DocDesk data model

Matches `schema.postgres.sql` and `schema.sqlite.sql`. Update all three together.

```mermaid
erDiagram
    SUPPLIERS ||--o{ PRODUCTS : supplies
    SUPPLIERS ||--o{ PURCHASE_ORDERS : receives
    PRODUCTS  ||--o{ SALE_ITEMS : "sold as"
    PRODUCTS  ||--o{ PURCHASE_ORDER_ITEMS : "restocked by"
    CUSTOMERS ||--o{ SALES : places
    SALES     ||--|{ SALE_ITEMS : contains
    PURCHASE_ORDERS ||--|{ PURCHASE_ORDER_ITEMS : contains

    PRODUCTS {
        int id PK
        string sku UK
        string name
        string category
        string unit
        decimal cost_price
        decimal sale_price
        int stock_quantity
        int reorder_level "alert below this"
        int supplier_id FK
        bool is_active
    }
    CUSTOMERS {
        int id PK
        string name
        string phone
        string email
        text address
    }
    SUPPLIERS {
        int id PK
        string name
        string contact_name
        string phone
        string email
    }
    SALES {
        int id PK
        string reference UK
        int customer_id FK
        decimal subtotal
        decimal tax
        decimal discount
        decimal total
        string payment_status "unpaid|partial|paid|refunded"
        string payment_method
    }
    SALE_ITEMS {
        int id PK
        int sale_id FK
        int product_id FK "null if product deleted"
        string description "copied, not joined"
        decimal quantity
        decimal unit_price
        decimal line_total
    }
    PURCHASE_ORDERS {
        int id PK
        string reference UK
        int supplier_id FK
        string status "draft|ordered|partial|received|cancelled"
        date expected_date
        date received_date
        decimal total
    }
    PURCHASE_ORDER_ITEMS {
        int id PK
        int purchase_order_id FK
        int product_id FK
        string description
        decimal quantity
        decimal quantity_received
        decimal unit_cost
    }
    MESSAGE_LOG {
        int id PK
        string channel
        string recipient
        string subject
        text body
        string trigger_type "eg low_stock"
        string status "queued|sent|failed"
        string related_type
        int related_id
    }
    USERS {
        int id PK
        string username UK
        string password_hash
        string role
    }
```

## Two things worth knowing

**Line items copy their description rather than joining for it.** `sale_items.description`
is written at the time of sale. Rename or delete a product afterwards and an old
receipt still reads correctly — which is the whole point of a receipt.
`product_id` is kept alongside it for reporting, and goes null if the product is
deleted.

**`message_log` is a queue, not a history.** Phase 2 writes rows here with status
`queued` when a trigger fires (stock dropping below `reorder_level`, an order
being confirmed). Nothing actually sends until Phase 6. Reading this table is how
you check the trigger logic works.

**`users` is unused so far.** Auth is deferred — see `memory.md`.
