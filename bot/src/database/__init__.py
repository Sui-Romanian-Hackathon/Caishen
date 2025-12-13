from src.database.postgres import (
    init_database,
    close_database,
    ensure_user,
    get_user,
    get_user_wallet,
    link_wallet,
    get_contacts,
    add_contact,
    remove_contact,
)

__all__ = [
    "init_database",
    "close_database",
    "ensure_user",
    "get_user",
    "get_user_wallet",
    "link_wallet",
    "get_contacts",
    "add_contact",
    "remove_contact",
]
