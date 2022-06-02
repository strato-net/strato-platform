#import pandas as pd
#import ast
import json
from collections import defaultdict
import time 
        
import os

fileNames = ['vm-runner', 'strato-sequencer']

#file1 = 

file1 = open('myVmRunnerLog.txt', 'w')
file1.close()


file1 = open('mySequencerLog.txt', 'w')
file1.close()

file1 = open('myP2pLog.txt', 'w')
file1.close()


currentBlockNumber = 0
  
def makeData(linesVmRunner, linesSequencer, linesP2p):
    insertionTimes = []

    for line in linesVmRunner:
        if "#### Block #" in line:
            insertionTimes.append(line)

    del(linesVmRunner)
    

    vmRunner = []
    for x in insertionTimes:
        blockNumber = x.split("#### Block #" )[1].split(' ')[0]
        timeItTookToProccess = x.split("time = " )[1].split(' ')[0].split('s')[0]
        numberOfTransactions = x.split(" (")[1].split(' ')[0]
        timeStampe = x.split("]" )[0][1:]
        vmRunner.append([blockNumber, timeItTookToProccess, numberOfTransactions, timeStampe])
    
    print("Length of Vm-runner",len(vmRunner))
    if len(vmRunner) != 0: 
        #print(vmRunner)
        final= []
        with open("myVmRunnerLog.txt") as fp:
            lineFromText = fp.readlines()
            d = defaultdict(int)
            for line in lineFromText:
                if (not line) or (line == None): pass
                #print(line)
                if line != "" or  line != "\n":
                    res = json.loads(line)
                    d[res[0]]=1
            for x in vmRunner:
                #if (not line) or (line == None): pass
                #print(line)
                if d[x[0]] != 1:
                    final.append(x)    
        fp.close()
        
        file1 = open("myVmRunnerLog.txt", "a")  # append mode
        for x in final:
            file1.write( json.dumps(x) +"\n")
            currentBlockNumber = x[0]
        file1.close()

        del(vmRunner)

    sequenceLog = []
    for line in linesSequencer:
        if "| Block #"  in line:
            sequenceLog.append(line)

    print("SequenceLog Length", len(sequenceLog))
    del(linesSequencer)
    #just read first line.
    sequences = []
    for x in sequenceLog:
        blockNumber = x.split("| Block #" )[1].split('/')[0]
        timeStampe = x.split("]" )[0][1:]
        #print(blockNumber, timeStampe)
        sequences.append([blockNumber, timeStampe])
    if len(sequences) == 0: 
        print("Are we getting a bad read")
        return 0
    #print(vmRunner)
    final= []
    with open("mySequencerLog.txt") as fp:
        lineFromText = fp.readlines()
        d = defaultdict(int)
        for line in lineFromText:
            if (not line) or (line == None): pass
            #print(line)
            if line != "" or  line != "\n":
                res = json.loads(line)
                d[res[0]]=1
        for x in sequences:
            #if (not line) or (line == None): pass
            #print(line)
            if d[x[0]] != 1:
                final.append(x)    
    fp.close()
    
    file1 = open("mySequencerLog.txt", "a")  # append mode
    for x in final:
        file1.write( json.dumps(x) +"\n")
    file1.close()


    logP2p = []
    for line in linesP2p:
        if "Block Numbers"  in line:
            logP2p.append(line)

    print("P2p Log Length", len(logP2p))
    del(linesP2p)
    #just read first line.
    p2pArrays = []
    for x in logP2p:
        blockNumbers = json.loads(x.split("Block Numbers")[1])
        timeStampe = x.split("]" )[0][1:]
        if type(blockNumbers) == list and len(blockNumbers) <= 0: pass
        #print("readinng from p2p log", blockNumbers, timeStampe, type(blockNumbers), type(blockNumbers[0]))
        #print("Test P2p input", blockNumbers)
        p2pArrays.append([blockNumbers, timeStampe])
    if len(p2pArrays) == 0:
        print("Are we getting a bad read")
        return 0
    #print("first p2p log scrape line", p2pArrays[0])
    final= []
    with open("myP2pLog.txt") as fp:
        lineFromText = fp.readlines()
        d = defaultdict(int)
        dt =  defaultdict(int)
        for line in lineFromText:
            if (not line) or (line == None): pass
            #print(line)
            if line != "" or  line != "\n":
                res = json.loads(line)
                #print("---res---", res[0])
                for blockN in res[0]:
                #Need to change this to a foreach
                    #print("------", blockN)
                    if type(blockN) == int:
                        d[blockN]=1
                    if type(blockN) == list:
                        for z in blockN:
                            if type(z)== int:
                                d[z]=1
                        #print(res[1])
                        dt[res[1]]=1
        
        for x in p2pArrays:
            #if (not line) or (line == None): pass
            #print(line)
            writeToFileRes = []
            for blockN in x[0]:
                #print("double check this is a time stamp", x[1])
                #print(type(blockN))
                #print("--BlockN in final write", blockN)
                if type(blockN) == int and d[blockN] != 1 and dt[x[1]] !=1:
                    writeToFileRes.append(x)
                    d[blockN]=1
                else: print("Why did we fale at line 164", type(blockN))
            final.append([writeToFileRes, x[1]])
    fp.close()

    file1 = open("myP2pLog.txt", "a")  # append mode
    for x in final:
        if type(x[0]) != list and type(x[0][0]) != int and type(x[1]) != str: 
            print("Not proper type, write to file fail")
            pass
        file1.write(json.dumps(x) +"\n")

        print("WRITE TO FILE LOOK LIKE THIS", json.dumps(x))
    file1.close()

    


count = 0
while count < 30000:#currentBlockNumber < 270000:
    file1 = open('vm-runner', 'r')
    
    #Get vm-runner log as an array of string lines
    linesVmRunner = file1.readlines()
    file1.close()

    #Get Sequencer file as an array of string lines
    file1 = open('strato-sequencer', 'r')
    linesSequencer = file1.readlines()
    #print("READ FILE LENGTH", linesSequencer)
    file1.close()
    

    file1 = open('strato-p2p', 'r')
    linesP2p = file1.readlines()
    #print("READ FILE LENGTH", linesSequencer)
    file1.close()


    
    makeData(linesVmRunner, linesSequencer, linesP2p)
    
    try:
        file1 = open('rotation/vm-runner', 'r')

        #Get vm-runner log as an array of string lines
        linesVmRunner = file1.readlines()
        file1.close()

        #Get Sequencer file as an array of string lines
        file1 = open('rotation/strato-sequencer', 'r')
        linesSequencer = file1.readlines()
        #print("READ FILE LENGTH", linesSequencer)
        file1.close()
        
        #Get Sequencer file as an array of string lines
        file1 = open('rotation/strato-p2p', 'r')
        linesP2p = file1.readlines()
        #print("READ FILE LENGTH", linesSequencer)
        file1.close()


        makeData(linesVmRunner, linesSequencer, linesP2p)

    except:
        pass

    finally:
        pass
    

    #NOTE TO SELF COMMENT THIS OUT LATER
    file1 = open("myVmRunnerLog.txt", 'r')
    Lines = file1.readlines()
    file1.seek(0, os.SEEK_END)
    count = len(Lines)
    print("length of final vm-runner output", len(Lines), "current block number", currentBlockNumber, "Number of bytes", file1.tell())
    file1.close()
    
    file1 = open("mySequencerLog.txt", 'r')
    Lines = file1.readlines()
    file1.close()
    print("length of final sequencer output", len(Lines) )
    count = max(len(Lines), count)

    time.sleep(15)

