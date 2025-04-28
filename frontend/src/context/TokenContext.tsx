"use client";

// context/TokenContext.tsx
import { TokenData } from "@/interface/token";
import axios from "axios";
import React, { createContext, useContext, useEffect, useState } from "react";

interface TokenContextType {
    tokens: TokenData[] | null;
    loading: boolean;
}

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: React.ReactNode }) => {
    const [tokens, setTokens] = useState<TokenData[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const res = await axios.get('api/tokens/');
                const rawData = res.data as { _name: string; _symbol: string; address: string }[];

                // FIRST: filter tokens that have non-empty _name and _symbol
                const filteredData = rawData.filter((d) => d._name?.trim() && d._symbol?.trim());

                const formattedData = filteredData.map((d: { _name: string,_symbol: string, address: string }) => {
                    return {
                        _name: d._name,
                        _symbol: d?._symbol,
                        address: d.address || '',
                    };
                });
                setTokens(formattedData);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchTokens();
    }, []);

    return (
        <TokenContext.Provider value={{ tokens, loading }}>
            {children}
        </TokenContext.Provider>
    );
};

export const useTokens = () => {
    const context = useContext(TokenContext);
    if (!context) {
        throw new Error("useTokens must be used within a TokenProvider");
    }
    return context;
};
