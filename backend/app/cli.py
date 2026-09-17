import argparse
import asyncio
import sys
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User, UserRole


async def set_role(email: str, role: str):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email.lower()))
        user = result.scalar_one_or_none()
        if not user:
            print(f"[ERROR] User with email '{email}' not found in database.", file=sys.stderr)
            sys.exit(1)

        try:
            target_role = UserRole(role.lower())
        except ValueError:
            print(f"[ERROR] Invalid role '{role}'. Must be 'admin' or 'user'.", file=sys.stderr)
            sys.exit(1)

        user.role = target_role
        await session.commit()
        print(f"[SUCCESS] User '{email}' role updated to: {target_role.value}")


async def list_users():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).order_by(User.created_at.desc()))
        users = result.scalars().all()
        if not users:
            print("No users found in database.")
            return

        print(f"{'ID':<38} | {'EMAIL':<30} | {'ROLE':<8} | {'PROVIDER':<10} | {'CREATED'}")
        print("-" * 105)
        for u in users:
            created = u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else "N/A"
            role_str = u.role.value if isinstance(u.role, UserRole) else str(u.role)
            print(f"{u.id:<38} | {u.email:<30} | {role_str:<8} | {u.oauth_provider:<10} | {created}")


def main():
    parser = argparse.ArgumentParser(description="ClaimSpace User & Role Management CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # set-role
    set_role_parser = subparsers.add_parser("set-role", help="Set user role to admin or user")
    set_role_parser.add_argument("--email", required=True, help="User email address")
    set_role_parser.add_argument("--role", required=True, choices=["admin", "user"], help="New role")

    # list-users
    subparsers.add_parser("list-users", help="List all registered users")

    args = parser.parse_args()

    if args.command == "set-role":
        asyncio.run(set_role(args.email, args.role))
    elif args.command == "list-users":
        asyncio.run(list_users())


if __name__ == "__main__":
    main()
