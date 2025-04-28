"use client";

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import axios from 'axios';

export default function Navbar() {
  const pathname = usePathname();
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [userAddress, setUserAddress] = useState('');

  const isActiveParentRoute = (routes: string[]) =>
    routes.some(route => pathname.startsWith(route));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    axios.get('api/users/me')
      .then(response => {
        localStorage.setItem("user", JSON.stringify(response.data)); 
        setUserAddress(response.data.userAddress);
      })
      .catch(error => {
        console.error('Error fetching user data:', error);
      });
  }, []);

  const handleLogout = () => {
    console.log("Logging out...");
    setShowPopover(false);
    localStorage.removeItem("user");
    window.location.href = "/auth/logout";
  };

  return (
    <nav className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white shadow-lg">
      <div className="w-full px-4 md:px-6 py-3 flex items-center justify-between">
        {/* Left Side */}
        <div className="flex items-center gap-20">
          <Link href="/dashboard" className="flex items-center gap-4 p-2">
            <Image src="/navbarIcon.png" alt="Navbar Logo" width={130} height={60} />
          </Link>

          <div className="hidden sm:flex items-center gap-8 text-[15px] font-semibold">
            <span className="text-white/60 cursor-not-allowed">Buy/Bridge</span>

            <Link
              href="/swap"
              className={`transition ${
                isActiveParentRoute(['/swap', '/pool']) ? 'text-cyan-300 underline' : 'text-white/90 hover:text-cyan-300'
              }`}
            >
              Swap
            </Link>

            <Link
              href="/deposits"
              className={`transition ${
                isActiveParentRoute(['/lend', '/borrow', '/admin']) ? 'text-cyan-300 underline' : 'text-white/90 hover:text-cyan-300'
              }`}
            >
              Lend/Borrow
            </Link>

            <Link
              href="/transfer"
              className={`transition ${
                isActiveParentRoute(['/lend', '/borrow', '/admin']) ? 'text-cyan-300 underline' : 'text-white/90 hover:text-cyan-300'
              }`}
            >
              Transfer
            </Link>

            <span className="text-white/60 cursor-not-allowed">Markets</span>
          </div>
        </div>
        {/* Right Side */}
        <div className="flex items-center gap-4">
          <span className="bg-white/10 text-cyan-200 px-4 py-1.5 rounded-full text-sm font-semibold">
            {userAddress}
          </span>
          <div className="relative" ref={popoverRef}>
            <button
              onClick={() => setShowPopover(!showPopover)}
              className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition"
              title="User Menu"
            >
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z" />
              </svg>
            </button>
            {showPopover && (
              <div className="absolute right-0 mt-2 w-52 bg-[#101c2c] text-white rounded-xl shadow-2xl z-50">
                <div className="p-3 border-b border-white/10">
                  <p className="text-base font-semibold">Connected Wallet</p>
                  <p className="text-sm text-cyan-300">0x75...c60f</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-2 text-base text-red-400 hover:bg-red-600/20 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
