import { util } from "blockapps-rest";
/** Factory creation for Properties arguments. */
const factory = {
    getPropertyArgs(uid) {
        const args = {
                productId: `${uid + 2}`.padStart(40, '0'),
                propertyType: `propertyType_${uid}`,
                listPrice: 1000000,
                streetNumber: 54,
                streetName: `streetName_${uid}`,
                unitNumber: `unitNumber_${uid}`,
                postalCity: `postalCity_${uid}`,
                stateOrProvince: `stateOrProvince_${uid}`,
                postalcode: 12345,
                bathroomsTotalInteger: 2,
                bedroomsTotal: 3,
                standardStatus: `standardStatus_${uid}`,
                lotSizeArea: 1000,
                lotSizeUnits: `lotSizeUnits_${uid}`,
                livingArea: 1000,
                livingAreaUnits: `livingAreaUnits_${uid}`,
                latitude: `latitude_${uid}`,
                longitude: `longitude_${uid}`,
                numberOfUnitsTotal: 2,
        
                // Appliances
                dishwasher: true,
                dryer: true,
                freezer: true,
                garbageDisposal: true,
                microwave: true,
                ovenOrRange: true,
                refrigerator: true,
                washer: true,
                waterHeater: true,
        
                // Cooling
                centralAir: true,
                evaporative: true,
                geoThermal: true,
                refrigeration: true,
                solar: true,
                wallUnit: true,
        
                // Heating
                baseboard: true,
                forceAir: true,
                geoThermalHeat: true,
                heatPump: true,
                hotWater: true,
                radiant: true,
                solarHeat: true,
                steam: true,
        
                // Flooring
                carpet: true,
                concrete: true,
                hardwood: true,
                laminate: true,
                linoleumVinyl: true,
                slate: true,
                softwood: true,
                tile: true,
        
                // Parking
                carport: true,
                garage: true,
                offStreet: true,
                onStreet: true,
        
                // Interior Features
                attic: true,
                cableReady: true,
                ceilingFan: true,
                doublePaneWindows: true,
                elevator: true,
                fireplace: true,
                flooring: true,
                furnished: true,
                jettedTub: true,
                securitySystem: true,
                vaultedCeiling: true,
                skylight: true,
                wetBar: true,
        
                // Exterior Features
                barbecueArea: true,
                deck: true,
                dock: true,
                fence: true,
                garden: true,
                hotTubOrSpa: true,
                lawn: true,
                patio: true,
                pond: true,
                pool: true,
                porch: true,
                rvParking: true,
                sauna: true,
                sprinklerSystem: true,
                waterFront: true,
        }
        return args;
    },
};

export default factory;
